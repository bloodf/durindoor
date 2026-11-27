// Topaz Labs native image enhance: one synchronous multipart POST to
// https://api.topazlabs.com/image/v1/enhance that answers with the enhanced
// image bytes. Staged as a guarded `generate` adapter for IMAGE_ADAPTERS and
// not registered.
//
// Source contract (OmniRoute c71f0065 handlers/imageGeneration.ts
// handleTopazImageGeneration): an input image is required; headers
// Accept image/jpeg + X-API-Key (apiKey, else accessToken), no Content-Type
// (multipart boundary set by fetch); form `image` (blob, file name image.png)
// then, when `size` is "WxH", `output_width` and `output_height`; the answer
// body is the image, returned as { b64_json } or { url: data:<type>;base64,… }
// with revised_prompt = body.prompt.
//
// Fork deviations: the input image must be inline (data: URI or bare base64)
// of a sniffed PNG, JPEG or WebP within a byte bound; remote URLs (the source
// fetched them) are refused, so no caller-chosen host is ever contacted; more
// than one input image, masks, chat `messages`, unknown fields, n other than
// 1, streaming and binary output are refused before anything is sent; a
// malformed size is refused instead of defaulting to 1024; the upload MIME is
// the sniffed one (a contradicting data: MIME is refused); redirects and
// foreign-origin answers are refused; the request has a deadline and follows
// the caller's signal; error messages never quote the upstream body; the
// answer must sniff as PNG, JPEG or WebP and its data: URL uses the sniffed
// type, not the upstream Content-Type; a submit whose outcome is unknown
// (timeout, abort or disconnect after send, 5xx, a 2xx that cannot be read or
// is not an image) carries `acceptedJob` and is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { sniffImageFormat } from "../../../utils/imageSniff.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  TOPAZ_ACCEPT, TOPAZ_API_ORIGIN, TOPAZ_AUTH_HEADER, TOPAZ_ENHANCE_URL, TOPAZ_IMAGE_FORMAT, TOPAZ_IMAGE_MIMES,
  TOPAZ_IMAGE_MODELS, TOPAZ_IMAGE_SIZES, TOPAZ_MAX_INPUT_IMAGE_BYTES, TOPAZ_MAX_OUTPUT_EDGE, TOPAZ_MAX_PROMPT_CHARS,
  TOPAZ_MIN_IMAGE_BYTES, TOPAZ_PROVIDER_ALIASES, TOPAZ_PROVIDER_ID, TOPAZ_RESPONSE_MAX_BYTES, TOPAZ_SUBMIT_TIMEOUT_MS,
  TOPAZ_TOTAL_TIMEOUT_MS, TOPAZ_UPLOAD_FILENAME,
} from "./config.js";
import { boundedFetch, discard, offOrigin, provenUnsent, readBoundedBytes } from "./http.js";

const MODALITY = "image";
const IMAGE_FIELDS = ["image", "image_url", "image_urls", "imageUrls"];
const ALLOWED_FIELDS = new Set(["model", "prompt", "size", "n", "response_format", "user", "stream", ...IMAGE_FIELDS]);
const MODEL_IDS = new Set(TOPAZ_IMAGE_MODELS.map((model) => model.id));
const RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URI_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.*)$/is;
const SIZE_RE = /^([1-9]\d{0,4})x([1-9]\d{0,4})$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Topaz image request aborted");
const present = (value) => value !== undefined && value !== null;

/** Accounting for a submit Topaz may have run (and may bill) whose outcome is not known. */
export function topazAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, TOPAZ_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: topazAcceptedJob(jobState) });

/** The canonical model id, or null. Strips a `topaz/` prefix. */
export function resolveTopazImageModel(model) {
  if (!isString(model)) return null;
  let id = model.trim();
  for (const prefix of [TOPAZ_PROVIDER_ID, ...TOPAZ_PROVIDER_ALIASES]) {
    if (id.startsWith(`${prefix}/`)) {
      id = id.slice(prefix.length + 1);
      break;
    }
  }
  return MODEL_IDS.has(id) ? id : null;
}

/** Source credential order: the connection's apiKey, else accessToken. */
export function resolveTopazImageCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/** "png" | "jpeg" | "webp" for bytes of a known container, else null. */
export function sniffTopazImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < TOPAZ_MIN_IMAGE_BYTES) return null;
  const format = sniffImageFormat(bytes);
  return format && TOPAZ_IMAGE_MIMES[format] ? format : null;
}

/** The one distinct input image string from the source's fields (in source order). */
function collectInputImages(body) {
  const seen = [];
  const push = (candidate, field) => {
    if (!present(candidate)) return;
    if (!isString(candidate)) throw reject(`Topaz ${field} must be a string`);
    const trimmed = candidate.trim();
    if (trimmed && !seen.includes(trimmed)) seen.push(trimmed);
  };
  push(body.image_url, "image_url");
  push(body.image, "image");
  for (const field of ["imageUrls", "image_urls"]) {
    if (!present(body[field])) continue;
    if (!Array.isArray(body[field])) throw reject(`Topaz ${field} must be an array`);
    for (const candidate of body[field]) push(candidate, field);
  }
  return seen;
}

/**
 * Decode one inline input image (data: URI or bare base64). Remote URLs are
 * refused: the staging never fetches a caller-chosen location.
 */
export function decodeTopazInputImage(source) {
  if (!isString(source) || !source.trim()) throw reject("Topaz image enhance requires an input image");
  const trimmed = source.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw reject("Topaz image enhance accepts inline images only (data: URI or base64); image URLs are not fetched");
  }
  let declared = null;
  let base64 = trimmed;
  const match = DATA_URI_RE.exec(trimmed);
  if (match) {
    declared = match[1].toLowerCase();
    base64 = match[2];
  } else if (trimmed.toLowerCase().startsWith("data:")) {
    throw reject("Topaz input image data: URI must be base64-encoded");
  }
  const maxChars = Math.ceil(TOPAZ_MAX_INPUT_IMAGE_BYTES / 3) * 4;
  if (base64.length > maxChars) throw reject(`Topaz input image must not exceed ${TOPAZ_MAX_INPUT_IMAGE_BYTES} bytes`);
  if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) throw reject("Topaz input image is not valid base64");
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.byteLength > TOPAZ_MAX_INPUT_IMAGE_BYTES) throw reject(`Topaz input image must not exceed ${TOPAZ_MAX_INPUT_IMAGE_BYTES} bytes`);
  const format = sniffTopazImage(bytes);
  if (!format) throw reject("Topaz input image must be a PNG, JPEG or WebP");
  const mime = TOPAZ_IMAGE_MIMES[format];
  if (declared && declared !== mime && !(format === "jpeg" && declared === "image/jpg")) {
    throw reject(`Topaz input image is ${format}, not the declared ${declared}`);
  }
  return { bytes, format, mime };
}

/**
 * Validate an OpenAI-style image request against the supported subset.
 * Throws a 400 error before any network call for anything refused.
 * @returns {{ model, prompt, image: { bytes, format, mime }, output: { width, height } | null, responseFormat }}
 */
export function parseTopazImageRequest(model, body) {
  const modelId = resolveTopazImageModel(model);
  if (!modelId) throw reject(`Unsupported Topaz image model: ${model}. Use one of: ${[...MODEL_IDS].join(", ")}`);
  if (!isRecord(body)) throw reject("Topaz image enhance needs a JSON object");
  for (const [key, value] of Object.entries(body)) {
    if (present(value) && !ALLOWED_FIELDS.has(key)) throw reject(`Topaz image enhance does not support ${key}`);
  }
  if (present(body.stream) && body.stream !== false) throw reject("Topaz image enhance does not support streaming");
  if (present(body.n) && body.n !== 1) throw reject("Topaz image enhance takes n = 1 only");
  const responseFormat = present(body.response_format) ? body.response_format : "url";
  if (!RESPONSE_FORMATS.includes(responseFormat)) {
    throw reject(`Topaz image enhance supports response_format ${RESPONSE_FORMATS.join(", ")} only`);
  }
  let prompt;
  if (present(body.prompt)) {
    if (!isString(body.prompt)) throw reject("Topaz prompt must be a string");
    if (body.prompt.length > TOPAZ_MAX_PROMPT_CHARS) throw reject(`Topaz prompts must not exceed ${TOPAZ_MAX_PROMPT_CHARS} characters`);
    prompt = body.prompt;
  }
  let output = null;
  if (present(body.size) && body.size !== "") {
    const sized = isString(body.size) ? SIZE_RE.exec(body.size.trim()) : null;
    const width = sized ? Number(sized[1]) : 0;
    const height = sized ? Number(sized[2]) : 0;
    if (!sized || width > TOPAZ_MAX_OUTPUT_EDGE || height > TOPAZ_MAX_OUTPUT_EDGE) {
      throw reject(`Topaz size must be WIDTHxHEIGHT with integer sides from 1 to ${TOPAZ_MAX_OUTPUT_EDGE}`);
    }
    output = { width, height };
  }
  const images = collectInputImages(body);
  if (images.length === 0) throw reject(`Topaz model ${modelId} requires an input image`);
  if (images.length > 1) throw reject("Topaz image enhance takes exactly one input image");
  const image = decodeTopazInputImage(images[0]);
  return { model: modelId, prompt, image, output, responseFormat };
}

/** The exact source multipart form: image, then output_width/output_height. */
export function buildTopazEnhanceForm(request) {
  const form = new FormData();
  form.append("image", new Blob([request.image.bytes], { type: request.image.mime }), TOPAZ_UPLOAD_FILENAME);
  if (request.output) {
    form.append("output_width", String(request.output.width));
    form.append("output_height", String(request.output.height));
  }
  return form;
}

/** Source request headers (no Content-Type: fetch sets the multipart boundary). */
export const buildTopazEnhanceHeaders = (token) => ({ Accept: TOPAZ_ACCEPT, [TOPAZ_AUTH_HEADER]: token });

function refusedAnswer(response, credentials) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status === 401 || status === 403) {
    return createErrorResult(status, "Topaz API key rejected", undefined, undefined, null, credentials);
  }
  if (status === 402) {
    // Out of credits on this connection only.
    return {
      ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "Topaz refused image enhance for this account (insufficient credits)", undefined, undefined, null, credentials),
      quotaExhausted: true,
    };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "Topaz rate limited image enhance", usable?.resetAtMs, undefined, usable, credentials);
  }
  if (status >= 500) {
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
      `Topaz image enhance failed with ${status}; whether it ran is unknown`, undefined, undefined, null, credentials), "submit-unknown");
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Topaz refused the image request with ${status}`, undefined, undefined, null, credentials);
}

/**
 * @param {object} [options] - test seams and bounds: { fetchImpl, submitTimeoutMs, timeoutMs, now }
 */
export function createTopazImageAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = TOPAZ_SUBMIT_TIMEOUT_MS,
    timeoutMs = TOPAZ_TOTAL_TIMEOUT_MS,
    now = Date.now,
  } = options;

  return {
    provider: TOPAZ_PROVIDER_ID,
    aliases: TOPAZ_PROVIDER_ALIASES,
    format: TOPAZ_IMAGE_FORMAT,
    models: TOPAZ_IMAGE_MODELS,
    supportedSizes: TOPAZ_IMAGE_SIZES,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Enhance one inline input image for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url | b64_json, revised_prompt }] }`, or an error
     * result that carries `acceptedJob` when Topaz may have run (and billed) it
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = parseTopazImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = resolveTopazImageCredential(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Topaz API key is required");
      if (signal?.aborted) return abortedResult();
      const proxyOptions = resolveCredentialProxyOptions(credentials);
      const deadline = now() + timeoutMs;
      const budget = Math.min(submitTimeoutMs, timeoutMs);

      let response;
      try {
        response = await boundedFetch(fetchImpl, TOPAZ_ENHANCE_URL, {
          method: "POST",
          headers: buildTopazEnhanceHeaders(token),
          body: buildTopazEnhanceForm(request),
          redirect: "manual",
          proxyOptions,
        }, { signal, timeoutMs: budget });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Topaz image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `Topaz image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
        ), "submit-unknown");
      }

      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        // Never followed: the API key must not travel to another location.
        discard(response);
        log?.debug?.("TOPAZ", "image request redirect refused");
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Topaz image request was redirected (refused)"), "submit-unknown");
      }
      if (offOrigin(response, TOPAZ_API_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Topaz image request was answered by another origin"), "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, credentials);

      let bytes;
      try {
        bytes = await readBoundedBytes(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: TOPAZ_RESPONSE_MAX_BYTES });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
        return withAcceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          error?.tooLarge ? "Topaz returned an image larger than the gateway accepts" : "Topaz returned an unreadable image response",
        ), "accepted");
      }
      const format = sniffTopazImage(bytes);
      if (!format) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Topaz image enhance returned no valid PNG, JPEG or WebP image"), "accepted");
      }

      const base64 = Buffer.from(bytes).toString("base64");
      const item = request.responseFormat === "b64_json"
        ? { b64_json: base64, revised_prompt: request.prompt }
        : { url: `data:${TOPAZ_IMAGE_MIMES[format]};base64,${base64}`, revised_prompt: request.prompt };
      const payload = { created: Math.floor(now() / 1000), data: [item] };
      const accounting = mediaAccounting(null, TOPAZ_PROVIDER_ID, MODALITY);
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
