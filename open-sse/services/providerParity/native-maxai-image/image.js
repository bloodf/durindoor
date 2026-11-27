// MaxAI native image generation: one signed, synchronous POST to
// https://api.maxai.me/gpt/get_image_generate_response. Staged as a guarded
// `generate` adapter for IMAGE_ADAPTERS and not registered.
//
// Source contract (OmniRoute c71f0065 handlers/imageGeneration/providers/
// maxaiImage.ts): body { prompt, style, size, n, model_name } in that order,
// headers = static Firefox-150 identity + signed X-Authorization set + Bearer
// access token + JSON content type; answer { status: "OK", data: [{ png_url,
// webp_url }] } (status must be "OK"); png_url preferred, then webp_url,
// then url.
//
// Fork deviations: unknown models, sizes the source would have snapped
// (gpt-image-1 / dall-e-3) or passed blindly, n above 4 or not an integer,
// masks, input images, OpenAI quality/output options, streaming and
// b64_json output are refused before anything is signed or sent, instead of
// being clamped, snapped or dropped; redirects are refused; the request has a
// deadline and follows the caller's signal; error messages never quote the
// upstream body; result URLs must be public https and are never fetched; a
// submit whose outcome is unknown (timeout, abort or disconnect after send,
// 5xx, a 2xx that cannot be read or holds no usable image) carries
// `acceptedJob` and is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  MAXAI_API_ORIGIN, MAXAI_IMAGE_DEFAULT_SIZE, MAXAI_IMAGE_DEFAULT_STYLE, MAXAI_IMAGE_MAX_N, MAXAI_IMAGE_MODEL_ALIASES,
  MAXAI_IMAGE_MODELS, MAXAI_IMAGE_PATH, MAXAI_IMAGE_SIZES, MAXAI_IMAGE_URL, MAXAI_MAX_PROMPT_CHARS, MAXAI_MAX_RESULT_URLS,
  MAXAI_PROVIDER_ALIASES, MAXAI_PROVIDER_ID, MAXAI_RESPONSE_MAX_BYTES, MAXAI_STRICT_SIZES, MAXAI_SUBMIT_TIMEOUT_MS,
  MAXAI_TOTAL_TIMEOUT_MS,
} from "./config.js";
import { boundedFetch, createMaxaiConstantsSource, discard, offOrigin, provenUnsent, readText } from "./http.js";
import { buildMaxaiSignedHeaders, maxaiStaticHeaders, resolveMaxaiImageCredential } from "./signing.js";

const MODALITY = "image";
const MAX_URL_LENGTH = 4096;
const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;
const STYLE_RE = /^[A-Za-z0-9 _-]{1,64}$/;
const ALLOWED_FIELDS = new Set(["model", "prompt", "size", "n", "style", "response_format", "user", "stream"]);
const MODEL_IDS = new Set(MAXAI_IMAGE_MODELS.map((model) => model.id));

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "MaxAI image request aborted");

/** Accounting for a submit MaxAI may have run (and may bill) whose outcome is not known. */
export function maxaiAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, MAXAI_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: maxaiAcceptedJob(jobState) });

/**
 * The canonical MaxAI model id, or null. Strips a `maxai/` or `mx/` prefix and
 * resolves the source's model-name aliases.
 */
export function resolveMaxaiImageModel(model) {
  if (!isString(model)) return null;
  let id = model.trim();
  for (const prefix of [MAXAI_PROVIDER_ID, ...MAXAI_PROVIDER_ALIASES]) {
    if (id.startsWith(`${prefix}/`)) {
      id = id.slice(prefix.length + 1);
      break;
    }
  }
  id = MAXAI_IMAGE_MODEL_ALIASES[id] ?? id;
  return MODEL_IDS.has(id) ? id : null;
}

function sizeFor(model, size) {
  if (size === undefined || size === null || size === "") return MAXAI_IMAGE_DEFAULT_SIZE;
  if (!isString(size)) throw reject("MaxAI image size must be a string");
  const strict = MAXAI_STRICT_SIZES[model];
  if (strict) {
    if (!strict.includes(size)) throw reject(`MaxAI ${model} size must be one of: ${strict.join(", ")}`);
    return size;
  }
  const match = SIZE_RE.exec(size);
  const ok = match && [match[1], match[2]].every((side) => Number(side) >= 256 && Number(side) <= 2048);
  if (!ok) throw reject("MaxAI image size must be WIDTHxHEIGHT with sides from 256 to 2048");
  return size;
}

/**
 * The exact MaxAI request body for an OpenAI-style image request, in the
 * source's field order. Throws a 400 error for anything this subset refuses.
 */
export function buildMaxaiImageRequest(model, body) {
  const modelName = resolveMaxaiImageModel(model);
  if (!modelName) throw reject(`Unsupported MaxAI image model: ${model}. Use one of: ${[...MODEL_IDS].join(", ")}`);
  if (!isRecord(body)) throw reject("MaxAI image generation needs a JSON object");
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null && !ALLOWED_FIELDS.has(key)) throw reject(`MaxAI image generation does not support ${key}`);
  }
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for MaxAI image generation");
  const prompt = body.prompt.trim();
  if (prompt.length > MAXAI_MAX_PROMPT_CHARS) throw reject(`MaxAI image prompts must not exceed ${MAXAI_MAX_PROMPT_CHARS} characters`);
  if (body.stream !== undefined && body.stream !== null && body.stream !== false) throw reject("MaxAI image generation does not support streaming");
  if (body.response_format !== undefined && body.response_format !== null && body.response_format !== "url") {
    throw reject("MaxAI image generation supports response_format url only");
  }
  const n = body.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > MAXAI_IMAGE_MAX_N) throw reject(`MaxAI image generation takes n from 1 to ${MAXAI_IMAGE_MAX_N}`);
  let style = MAXAI_IMAGE_DEFAULT_STYLE;
  if (body.style !== undefined && body.style !== null && body.style !== "") {
    if (!isString(body.style) || !STYLE_RE.test(body.style)) throw reject("MaxAI image style must be a short word such as vivid or natural");
    style = body.style;
  }
  return { prompt, style, size: sizeFor(modelName, body.size), n, model_name: modelName };
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function maxaiPublicUrl(raw) {
  if (!isString(raw) || !raw || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  return url.href;
}

/** Source extractMaxaiImageUrls, keeping only public https URLs (bounded, de-duplicated). */
export function extractMaxaiImageUrls(answer) {
  const items = Array.isArray(answer) ? answer : Array.isArray(answer?.data) ? answer.data : [];
  const urls = new Set();
  let unsafe = 0;
  for (const item of items.slice(0, MAXAI_MAX_RESULT_URLS * 2)) {
    if (!isRecord(item)) continue;
    const raw = [item.png_url, item.webp_url, item.url].find((value) => isString(value) && value);
    if (!raw) continue;
    const url = maxaiPublicUrl(raw);
    if (url) urls.add(url);
    else unsafe += 1;
  }
  return { urls: [...urls].slice(0, MAXAI_MAX_RESULT_URLS), unsafe };
}

async function refusedAnswer(response, secrets) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status === 418) {
    // Source: 418 is MaxAI's masked TLS/JA3 reject; the session cannot be used from here.
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "MaxAI rejected the session (418)", undefined, undefined, null, secrets);
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, "MaxAI session expired or rejected", undefined, undefined, null, secrets);
  }
  if (status === 402) {
    // Out of credits on this connection only.
    return { ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "MaxAI refused image generation for this account", undefined, undefined, null, secrets), quotaExhausted: true };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "MaxAI rate limited image generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status >= 500) {
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `MaxAI image generation failed with ${status}; whether it ran is unknown`, undefined, undefined, null, secrets), "submit-unknown");
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `MaxAI refused the image request with ${status}`, undefined, undefined, null, secrets);
}

/**
 * @param {object} [options] - test seams and bounds: { fetchImpl, constants,
 *   constantsSource, discover, submitTimeoutMs, timeoutMs, now, random, salt }
 */
export function createMaxaiImageAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = MAXAI_SUBMIT_TIMEOUT_MS,
    timeoutMs = MAXAI_TOTAL_TIMEOUT_MS,
    now = Date.now,
    random,
    salt,
  } = options;
  const constantsSource = options.constantsSource ?? createMaxaiConstantsSource({ constants: options.constants, discover: options.discover });

  return {
    provider: MAXAI_PROVIDER_ID,
    aliases: MAXAI_PROVIDER_ALIASES,
    models: MAXAI_IMAGE_MODELS,
    supportedSizes: MAXAI_IMAGE_SIZES,
    responseFormats: Object.freeze(["url"]),
    defaultResponseFormat: "url",
    constantsSource,
    /**
     * Generate images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url }] }`, or an error result that carries
     * `acceptedJob` when MaxAI may have run (and billed) the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildMaxaiImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const auth = resolveMaxaiImageCredential(credentials);
      if (!auth) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "MaxAI access token, device ID and user ID are required");
      if (signal?.aborted) return abortedResult();
      const secrets = { accessToken: auth.token, apiKey: credentials?.apiKey, cookie: credentials?.cookie };
      const proxyOptions = resolveCredentialProxyOptions(credentials);
      const deadline = now() + timeoutMs;

      let constants;
      try {
        constants = await constantsSource.resolve({ credentials, fetchImpl, signal, proxyOptions, now });
      } catch {
        constants = null;
      }
      if (signal?.aborted) return abortedResult();
      if (!constants) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "MaxAI signing constants are unavailable; reconnect the browser session");
      const left = deadline - now();
      if (left <= 0) return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "MaxAI image request ran out of time before it was sent");

      const headers = {
        ...maxaiStaticHeaders(),
        ...buildMaxaiSignedHeaders({ path: MAXAI_IMAGE_PATH, userId: auth.userId, deviceId: auth.deviceId, now, random, salt }, constants),
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      };
      const budget = Math.min(submitTimeoutMs, left);

      let response;
      try {
        response = await boundedFetch(fetchImpl, MAXAI_IMAGE_URL, {
          method: "POST", headers, body: JSON.stringify(request), redirect: "manual", proxyOptions,
        }, { signal, timeoutMs: budget });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MaxAI image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `MaxAI image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
        ), "submit-unknown");
      }

      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        // A redirect is MaxAI's signed-out answer; it is refused, never followed with the token.
        discard(response);
        log?.debug?.("MAXAI", "image request redirect refused");
        return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "MaxAI session expired (redirect refused)");
      }
      if (offOrigin(response, MAXAI_API_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MaxAI image request was answered by another origin"), "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, secrets);

      let answer;
      try {
        const text = await readText(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: MAXAI_RESPONSE_MAX_BYTES });
        answer = JSON.parse(text);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
        return withAcceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "MaxAI returned an unreadable image response",
        ), "accepted");
      }
      const status = isRecord(answer) ? answer.status : undefined;
      if (status !== "OK") {
        const shown = isString(status) && /^[A-Za-z_]{1,32}$/.test(status) ? status : "unknown";
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `MaxAI image generation returned no images (status=${shown})`), "accepted");
      }
      const { urls, unsafe } = extractMaxaiImageUrls(answer);
      if (urls.length === 0) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          `MaxAI image generation returned no usable ${unsafe ? "public https " : ""}image URL`), "accepted");
      }

      const payload = { created: Math.floor(now() / 1000), data: urls.map((url) => ({ url })) };
      const accounting = mediaAccounting(null, MAXAI_PROVIDER_ID, MODALITY);
      returnedImageUnits(accounting, payload);
      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}
