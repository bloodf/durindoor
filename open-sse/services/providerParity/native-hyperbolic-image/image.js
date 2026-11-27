// Hyperbolic native image generation: one synchronous POST to
// https://api.hyperbolic.xyz/v1/image/generation. Staged as a guarded
// `generate` adapter for IMAGE_ADAPTERS and not registered.
//
// Source contract (OmniRoute c71f0065 handlers/imageGeneration/providers/
// hyperbolic.ts): body { model_name, prompt, height, width, backend: "auto" }
// in that order, headers Content-Type application/json + Authorization
// Bearer (apiKey, else accessToken); answer { images: [{ image: <base64> }] }
// mapped to OpenAI { created, data: [{ b64_json, revised_prompt: prompt }] }.
//
// Fork deviations: unknown models, sizes outside the registry list (the source
// split any string and defaulted NaN sides to 1024), n other than 1 (the
// source fanned out one billable call per image), masks, input images, extra
// sampler options, streaming and url/binary output are refused before
// anything is sent, instead of being dropped or reshaped; redirects are
// refused; the request has a deadline and follows the caller's signal; error
// messages never quote the upstream body; every returned image must be strict
// base64 of a PNG, JPEG or WebP; a submit whose outcome is unknown (timeout,
// abort or disconnect after send, 5xx, a 2xx that cannot be read or holds no
// usable image) carries `acceptedJob` and is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  HYPERBOLIC_API_ORIGIN, HYPERBOLIC_IMAGE_BACKEND, HYPERBOLIC_IMAGE_FORMAT, HYPERBOLIC_IMAGE_DEFAULT_SIZE, HYPERBOLIC_IMAGE_MODELS,
  HYPERBOLIC_IMAGE_SIZES, HYPERBOLIC_IMAGE_URL, HYPERBOLIC_MAX_IMAGE_B64_CHARS, HYPERBOLIC_MAX_PROMPT_CHARS,
  HYPERBOLIC_MAX_RESULT_IMAGES, HYPERBOLIC_PROVIDER_ALIASES, HYPERBOLIC_PROVIDER_ID, HYPERBOLIC_RESPONSE_MAX_BYTES,
  HYPERBOLIC_SUBMIT_TIMEOUT_MS, HYPERBOLIC_TOTAL_TIMEOUT_MS,
} from "./config.js";
import { boundedFetch, discard, offOrigin, provenUnsent, readText } from "./http.js";

const MODALITY = "image";
const ALLOWED_FIELDS = new Set(["model", "prompt", "size", "n", "response_format", "user", "stream"]);
const MODEL_IDS = new Set(HYPERBOLIC_IMAGE_MODELS.map((model) => model.id));
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Hyperbolic image request aborted");
const present = (value) => value !== undefined && value !== null;

/** Accounting for a submit Hyperbolic may have run (and may bill) whose outcome is not known. */
export function hyperbolicAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, HYPERBOLIC_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: hyperbolicAcceptedJob(jobState) });

/** The canonical model id, or null. Strips a `hyperbolic/` or `hyp/` prefix. */
export function resolveHyperbolicImageModel(model) {
  if (!isString(model)) return null;
  let id = model.trim();
  for (const prefix of [HYPERBOLIC_PROVIDER_ID, ...HYPERBOLIC_PROVIDER_ALIASES]) {
    if (id.startsWith(`${prefix}/`)) {
      id = id.slice(prefix.length + 1);
      break;
    }
  }
  return MODEL_IDS.has(id) ? id : null;
}

/** Source credential order: the connection's apiKey, else accessToken. */
export function resolveHyperbolicImageCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The exact Hyperbolic request body for an OpenAI-style image request, in the
 * source's field order. Throws a 400 error for anything this subset refuses.
 */
export function buildHyperbolicImageRequest(model, body) {
  const modelName = resolveHyperbolicImageModel(model);
  if (!modelName) throw reject(`Unsupported Hyperbolic image model: ${model}. Use one of: ${[...MODEL_IDS].join(", ")}`);
  if (!isRecord(body)) throw reject("Hyperbolic image generation needs a JSON object");
  for (const [key, value] of Object.entries(body)) {
    if (present(value) && !ALLOWED_FIELDS.has(key)) throw reject(`Hyperbolic image generation does not support ${key}`);
  }
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for Hyperbolic image generation");
  const prompt = body.prompt.trim();
  if (prompt.length > HYPERBOLIC_MAX_PROMPT_CHARS) {
    throw reject(`Hyperbolic image prompts must not exceed ${HYPERBOLIC_MAX_PROMPT_CHARS} characters`);
  }
  if (present(body.stream) && body.stream !== false) throw reject("Hyperbolic image generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "b64_json") {
    throw reject("Hyperbolic image generation supports response_format b64_json only");
  }
  if (present(body.n) && body.n !== 1) throw reject("Hyperbolic image generation takes n = 1 only");
  const size = present(body.size) && body.size !== "" ? body.size : HYPERBOLIC_IMAGE_DEFAULT_SIZE;
  if (!HYPERBOLIC_IMAGE_SIZES.includes(size)) {
    throw reject(`Hyperbolic image size must be one of: ${HYPERBOLIC_IMAGE_SIZES.join(", ")}`);
  }
  const [width, height] = size.split("x").map(Number);
  return { model_name: modelName, prompt, height, width, backend: HYPERBOLIC_IMAGE_BACKEND };
}

/** "png" | "jpeg" | "webp" for strict base64 of a known image container, else null. */
export function sniffImageBase64(value) {
  if (!isString(value) || value.length < 16 || value.length > HYPERBOLIC_MAX_IMAGE_B64_CHARS) return null;
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) return null;
  const head = Buffer.from(value.slice(0, 16), "base64");
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Source `data.images[].image`, keeping only strict base64 images (bounded). */
export function extractHyperbolicImages(answer) {
  const items = isRecord(answer) && Array.isArray(answer.images) ? answer.images : [];
  const images = [];
  let unsafe = 0;
  for (const item of items.slice(0, HYPERBOLIC_MAX_RESULT_IMAGES * 2)) {
    const raw = isRecord(item) ? item.image : undefined;
    if (!present(raw)) continue;
    if (sniffImageBase64(raw)) images.push(raw);
    else unsafe += 1;
  }
  return { images: images.slice(0, HYPERBOLIC_MAX_RESULT_IMAGES), unsafe };
}

function refusedAnswer(response, credentials) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status === 401 || status === 403) {
    return createErrorResult(status, "Hyperbolic API key rejected", undefined, undefined, null, credentials);
  }
  if (status === 402) {
    // Out of credits on this connection only.
    return {
      ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "Hyperbolic refused image generation for this account (insufficient balance)", undefined, undefined, null, credentials),
      quotaExhausted: true,
    };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "Hyperbolic rate limited image generation", usable?.resetAtMs, undefined, usable, credentials);
  }
  if (status >= 500) {
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
      `Hyperbolic image generation failed with ${status}; whether it ran is unknown`, undefined, undefined, null, credentials), "submit-unknown");
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Hyperbolic refused the image request with ${status}`, undefined, undefined, null, credentials);
}

/**
 * @param {object} [options] - test seams and bounds: { fetchImpl, submitTimeoutMs, timeoutMs, now }
 */
export function createHyperbolicImageAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = HYPERBOLIC_SUBMIT_TIMEOUT_MS,
    timeoutMs = HYPERBOLIC_TOTAL_TIMEOUT_MS,
    now = Date.now,
  } = options;

  return {
    provider: HYPERBOLIC_PROVIDER_ID,
    aliases: HYPERBOLIC_PROVIDER_ALIASES,
    format: HYPERBOLIC_IMAGE_FORMAT,
    models: HYPERBOLIC_IMAGE_MODELS,
    supportedSizes: HYPERBOLIC_IMAGE_SIZES,
    responseFormats: Object.freeze(["b64_json"]),
    defaultResponseFormat: "b64_json",
    /**
     * Generate one image for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ b64_json, revised_prompt }] }`, or an error result
     * that carries `acceptedJob` when Hyperbolic may have run (and billed) it
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildHyperbolicImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = resolveHyperbolicImageCredential(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Hyperbolic API key is required");
      if (signal?.aborted) return abortedResult();
      const proxyOptions = resolveCredentialProxyOptions(credentials);
      const deadline = now() + timeoutMs;
      const budget = Math.min(submitTimeoutMs, timeoutMs);

      let response;
      try {
        response = await boundedFetch(fetchImpl, HYPERBOLIC_IMAGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions,
        }, { signal, timeoutMs: budget });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Hyperbolic image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `Hyperbolic image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
        ), "submit-unknown");
      }

      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        // Never followed: the Bearer key must not travel to another location.
        discard(response);
        log?.debug?.("HYPERBOLIC", "image request redirect refused");
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Hyperbolic image request was redirected (refused)"), "submit-unknown");
      }
      if (offOrigin(response, HYPERBOLIC_API_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Hyperbolic image request was answered by another origin"), "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, credentials);

      let answer;
      try {
        const text = await readText(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: HYPERBOLIC_RESPONSE_MAX_BYTES });
        answer = JSON.parse(text);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
        return withAcceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "Hyperbolic returned an unreadable image response",
        ), "accepted");
      }
      const { images, unsafe } = extractHyperbolicImages(answer);
      if (images.length === 0) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          `Hyperbolic image generation returned no ${unsafe ? "valid base64 PNG, JPEG or WebP " : ""}image`), "accepted");
      }

      const payload = {
        created: Math.floor(now() / 1000),
        data: images.map((b64) => ({ b64_json: b64, revised_prompt: request.prompt })),
      };
      const accounting = mediaAccounting(null, HYPERBOLIC_PROVIDER_ID, MODALITY);
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
