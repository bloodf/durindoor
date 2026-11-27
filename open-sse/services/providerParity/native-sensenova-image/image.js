// SenseNova (China) native image generation: one OpenAI-compatible JSON POST
// to https://api.sensenova.cn/v1/images/generations with the selected
// `sensenova` connection's Bearer key. Staged as a guarded `generate` adapter
// for IMAGE_ADAPTERS and not registered.
//
// Source contract (OmniRoute c71f0065 handleOpenAIImageGeneration, format
// "openai", no fallbackUrl): body { model, prompt } then output options, n,
// size, quality, response_format, style (each only when the caller set it);
// headers Content-Type application/json + Authorization Bearer; answer
// { created, data: [{ b64_json | url }], usage? }; a 2xx without a usable item
// is a 502; usage stays internal.
//
// Fork deviations: unsupported fields (input images, masks, backgrounds,
// animation frames, compression, watermark/prompt_extend, streaming), gif/svg
// output and malformed n/size/model values are refused before anything is
// sent instead of being dropped or forwarded blindly; redirects are refused;
// the submit has a deadline inside a total one and follows the caller's
// signal; error messages never quote the upstream body or the key; URLs must
// be public https and are never fetched; base64 items must decode as
// png/jpeg/webp; a submit whose outcome is unknown carries `acceptedJob` and
// is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { sniffImageFormat } from "../../../handlers/imageProviders/outputFormat.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SENSENOVA_IMAGE_MAX_N, SENSENOVA_IMAGE_MODELS, SENSENOVA_IMAGE_ORIGIN, SENSENOVA_IMAGE_SIZES, SENSENOVA_IMAGE_URL,
  SENSENOVA_MAX_PROMPT_CHARS, SENSENOVA_MAX_RESULTS, SENSENOVA_MAX_SIDE, SENSENOVA_MIN_SIDE, SENSENOVA_OUTPUT_FORMATS,
  SENSENOVA_PROVIDER_ALIASES, SENSENOVA_PROVIDER_ID, SENSENOVA_RESPONSE_FORMATS, SENSENOVA_RESPONSE_MAX_BYTES,
  SENSENOVA_SUBMIT_TIMEOUT_MS, SENSENOVA_TOTAL_TIMEOUT_MS,
} from "./config.js";
import { boundedFetch, discard, isRedirect, isSafeSensenovaModelId, offOrigin, provenUnsent, readText } from "./http.js";

const MODALITY = "image";
const MAX_URL_LENGTH = 4096;
const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;
const WORD_RE = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MIME = Object.freeze({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" });
const ALLOWED_FIELDS = new Set(["model", "prompt", "n", "size", "quality", "style", "response_format", "output_format", "user", "stream"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "SenseNova image request aborted");
const present = (value) => value !== undefined && value !== null;

/** Accounting for a submit SenseNova may have run (and may bill) whose outcome is not known. */
export function sensenovaAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, SENSENOVA_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: sensenovaAcceptedJob(jobState) });

/** The selected connection's key: source `credentials.apiKey || credentials.accessToken`. */
export function resolveSensenovaImageCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The upstream model id, or null. Strips a `sensenova/` prefix (the source
 * registry's id and alias). Like the source's prefixed routing, any safe id
 * passes through; SenseNova decides what the account serves.
 */
export function resolveSensenovaImageModel(model) {
  if (!isString(model)) return null;
  let id = model.trim();
  if (id.startsWith(`${SENSENOVA_PROVIDER_ID}/`)) id = id.slice(SENSENOVA_PROVIDER_ID.length + 1);
  return isSafeSensenovaModelId(id) ? id : null;
}

function checkSize(size) {
  if (!isString(size)) throw reject("SenseNova image size must be a WIDTHxHEIGHT string");
  const match = SIZE_RE.exec(size);
  const ok = match && [match[1], match[2]].every((side) => Number(side) >= SENSENOVA_MIN_SIDE && Number(side) <= SENSENOVA_MAX_SIDE);
  if (!ok) throw reject(`SenseNova image size must be WIDTHxHEIGHT with sides from ${SENSENOVA_MIN_SIDE} to ${SENSENOVA_MAX_SIDE}`);
  return size;
}

/**
 * The exact SenseNova request body for an OpenAI-style image request, in the
 * source's field order. Throws a 400 error for anything this subset refuses.
 */
export function buildSensenovaImageRequest(model, body) {
  const upstreamModel = resolveSensenovaImageModel(model);
  if (!upstreamModel) throw reject("SenseNova image generation needs a model id such as sensenova-u1-fast");
  if (!isRecord(body)) throw reject("SenseNova image generation needs a JSON object");
  for (const [key, value] of Object.entries(body)) {
    if (present(value) && !ALLOWED_FIELDS.has(key)) throw reject(`SenseNova image generation does not support ${key}`);
  }
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for SenseNova image generation");
  if (body.prompt.length > SENSENOVA_MAX_PROMPT_CHARS) throw reject(`SenseNova image prompts must not exceed ${SENSENOVA_MAX_PROMPT_CHARS} characters`);
  if (present(body.stream) && body.stream !== false) throw reject("SenseNova image generation does not support streaming");

  const request = { model: upstreamModel, prompt: body.prompt };
  if (present(body.output_format)) {
    const format = isString(body.output_format) ? body.output_format.trim().toLowerCase() : "";
    if (!SENSENOVA_OUTPUT_FORMATS.includes(format)) throw reject(`SenseNova output_format must be one of: ${SENSENOVA_OUTPUT_FORMATS.join(", ")}`);
    request.output_format = format;
  }
  if (present(body.n)) {
    if (!Number.isInteger(body.n) || body.n < 1 || body.n > SENSENOVA_IMAGE_MAX_N) throw reject(`SenseNova image generation takes n from 1 to ${SENSENOVA_IMAGE_MAX_N}`);
    request.n = body.n;
  }
  if (present(body.size)) request.size = checkSize(body.size);
  if (present(body.quality)) {
    if (!isString(body.quality) || !WORD_RE.test(body.quality)) throw reject("SenseNova image quality must be a short word");
    request.quality = body.quality;
  }
  if (present(body.response_format)) {
    if (!SENSENOVA_RESPONSE_FORMATS.includes(body.response_format)) throw reject("SenseNova image response_format must be url or b64_json");
    request.response_format = body.response_format;
  }
  if (present(body.style)) {
    if (!isString(body.style) || !WORD_RE.test(body.style)) throw reject("SenseNova image style must be a short word");
    request.style = body.style;
  }
  return request;
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function sensenovaPublicUrl(raw) {
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

/**
 * Source usable-item rule (b64_json or url), kept to public https URLs and
 * base64 that decodes as png/jpeg/webp. Returns `{ items, formats, unsafe }`.
 */
export function normalizeSensenovaImageItems(answer) {
  const raw = Array.isArray(answer?.data) ? answer.data : [];
  const items = [];
  const formats = new Set();
  let unsafe = 0;
  for (const item of raw.slice(0, SENSENOVA_MAX_RESULTS * 2)) {
    if (items.length >= SENSENOVA_MAX_RESULTS) break;
    if (!isRecord(item)) continue;
    if (isString(item.b64_json) && item.b64_json) {
      const format = BASE64_RE.test(item.b64_json) ? sniffImageFormat(item.b64_json) : undefined;
      if (MIME[format]) {
        items.push({ b64_json: item.b64_json, mime_type: MIME[format] });
        formats.add(format);
      } else unsafe += 1;
    } else if (isString(item.url) && item.url) {
      const url = sensenovaPublicUrl(item.url);
      if (url) items.push({ url });
      else unsafe += 1;
    }
  }
  return { items, formats, unsafe };
}

async function refusedAnswer(response, secrets) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status === 401 || status === 403) {
    return createErrorResult(status, "SenseNova rejected the API key", undefined, undefined, null, secrets);
  }
  if (status === 402) {
    return { ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "SenseNova refused image generation for this account (out of credit)", undefined, undefined, null, secrets), quotaExhausted: true };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "SenseNova rate limited image generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 404) {
    return createErrorResult(HTTP_STATUS.NOT_FOUND, "SenseNova does not serve this image model", undefined, undefined, null, secrets);
  }
  if (status >= 500) {
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `SenseNova image generation failed with ${status}; whether it ran is unknown`, undefined, undefined, null, secrets), "submit-unknown");
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `SenseNova refused the image request with ${status}`, undefined, undefined, null, secrets);
}

/**
 * @param {object} [options] - test seams and bounds: { fetchImpl, submitTimeoutMs, timeoutMs, now }
 */
export function createSensenovaImageAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = SENSENOVA_SUBMIT_TIMEOUT_MS,
    timeoutMs = SENSENOVA_TOTAL_TIMEOUT_MS,
    now = Date.now,
  } = options;

  return {
    provider: SENSENOVA_PROVIDER_ID,
    aliases: SENSENOVA_PROVIDER_ALIASES,
    models: SENSENOVA_IMAGE_MODELS,
    supportedSizes: SENSENOVA_IMAGE_SIZES,
    responseFormats: SENSENOVA_RESPONSE_FORMATS,
    /**
     * Generate images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json, mime_type }] }`, or an error
     * result that carries `acceptedJob` when SenseNova may have run the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildSensenovaImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const key = resolveSensenovaImageCredential(credentials);
      if (!key) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "SenseNova API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = { apiKey: key, accessToken: credentials?.accessToken };
      const deadline = now() + timeoutMs;
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(request),
        redirect: "manual",
        proxyOptions: resolveCredentialProxyOptions(credentials),
      };

      let response;
      try {
        response = await boundedFetch(fetchImpl, SENSENOVA_IMAGE_URL, init, { signal, timeoutMs: Math.min(submitTimeoutMs, timeoutMs) });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SenseNova image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `SenseNova image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
        ), "submit-unknown");
      }
      if (isRedirect(response)) {
        // Never followed: the Bearer key stays on the fixed origin.
        discard(response);
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SenseNova image request redirect refused");
      }
      if (offOrigin(response, SENSENOVA_IMAGE_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "SenseNova image request was answered by another origin"), "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, secrets);

      let answer;
      try {
        const text = await readText(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: SENSENOVA_RESPONSE_MAX_BYTES });
        answer = JSON.parse(text);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
        return withAcceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "SenseNova returned an unreadable image response",
        ), "accepted");
      }
      const { items, formats, unsafe } = normalizeSensenovaImageItems(answer);
      if (items.length === 0) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          `SenseNova image generation returned ${unsafe ? "no safe" : "no usable"} image`), "accepted");
      }
      if (request.output_format && formats.size > 0 && ![...formats].every((format) => format === request.output_format)) {
        log?.warn?.("IMAGE", `Image output format mismatch: requested ${request.output_format}, received ${[...formats].join(",")}`);
      }

      const created = Number.isInteger(answer?.created) && answer.created > 0 ? answer.created : Math.floor(now() / 1000);
      const payload = { created, data: items };
      if (items.every((item) => item.b64_json) && formats.size === 1) payload.output_format = [...formats][0];
      // Upstream usage (if any) becomes internal accounting tokens; cost stays unknown.
      const accounting = mediaAccounting(answer, SENSENOVA_PROVIDER_ID, MODALITY);
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
