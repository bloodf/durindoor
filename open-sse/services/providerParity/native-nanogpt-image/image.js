// NanoGPT native image generation: one OpenAI-compatible JSON POST to
// https://nano-gpt.com/api/v1/images/generations with the selected
// connection's Bearer key. Staged as a guarded `generate` adapter for
// IMAGE_ADAPTERS and not registered.
//
// Source contract (OmniRoute c71f0065 handleOpenAIImageGeneration, format
// "openai", no fallbackUrl): body { model, prompt } then output options, n,
// size, quality, response_format, style (each only when the caller set it);
// headers Content-Type application/json + Authorization Bearer; answer
// { created, data: [{ b64_json | url }], usage? }; a 2xx without a usable
// item is a 502; usage stays internal.
//
// Fork deviations: unsupported fields (input images, masks, backgrounds,
// animation frames, compression, streaming), gif/svg output and malformed
// n/size/model values are refused before anything is sent instead of being
// dropped or forwarded blindly (the source silently dropped input images for
// every NanoGPT model); redirects are refused; the request has a deadline
// inside a total one and follows the caller's signal; error messages never
// quote the upstream body or the key; URLs must be public https and are never
// fetched; base64 items must decode as png/jpeg/webp; a submit whose outcome is
// unknown carries `acceptedJob` and is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { sniffImageFormat } from "../../../handlers/imageProviders/outputFormat.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NANOGPT_IMAGE_MAX_N, NANOGPT_IMAGE_MODELS, NANOGPT_IMAGE_SIZES, NANOGPT_IMAGE_URL, NANOGPT_MAX_PROMPT_CHARS,
  NANOGPT_MAX_RESULTS, NANOGPT_MAX_SIDE, NANOGPT_MIN_SIDE, NANOGPT_ORIGIN, NANOGPT_OUTPUT_FORMATS,
  NANOGPT_PROVIDER_ALIASES, NANOGPT_PROVIDER_ID, NANOGPT_RESPONSE_FORMATS, NANOGPT_RESPONSE_MAX_BYTES,
  NANOGPT_SUBMIT_TIMEOUT_MS, NANOGPT_TOTAL_TIMEOUT_MS,
} from "./config.js";
import { boundedFetch, discard, isRedirect, isSafeNanoGptModelId, offOrigin, provenUnsent, readText } from "./http.js";

const MODALITY = "image";
const MAX_URL_LENGTH = 4096;
const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;
const WORD_RE = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MIME = Object.freeze({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" });
const ALLOWED_FIELDS = new Set(["model", "prompt", "n", "size", "quality", "style", "response_format", "output_format", "user", "stream"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "NanoGPT image request aborted");
const present = (value) => value !== undefined && value !== null;

/** Accounting for a submit NanoGPT may have run (and may bill) whose outcome is not known. */
export function nanoGptAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, NANOGPT_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: nanoGptAcceptedJob(jobState) });

/** The selected connection's key: source `credentials.apiKey || credentials.accessToken`. */
export function resolveNanoGptImageCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The upstream model id, or null. The image core already strips the routing
 * provider prefix, and NanoGPT serves real ids that start with `nanogpt/`
 * (e.g. nanogpt/coding-router), so the id is sent verbatim. Like the source,
 * any safe id passes through: NanoGPT decides what it serves.
 */
export function resolveNanoGptImageModel(model) {
  if (!isString(model)) return null;
  const id = model.trim();
  return isSafeNanoGptModelId(id) ? id : null;
}

function checkSize(size) {
  if (!isString(size)) throw reject("NanoGPT image size must be a WIDTHxHEIGHT string");
  const match = SIZE_RE.exec(size);
  const ok = match && [match[1], match[2]].every((side) => Number(side) >= NANOGPT_MIN_SIDE && Number(side) <= NANOGPT_MAX_SIDE);
  if (!ok) throw reject(`NanoGPT image size must be WIDTHxHEIGHT with sides from ${NANOGPT_MIN_SIDE} to ${NANOGPT_MAX_SIDE}`);
  return size;
}

/**
 * The exact NanoGPT request body for an OpenAI-style image request, in the
 * source's field order. Throws a 400 error for anything this subset refuses.
 */
export function buildNanoGptImageRequest(model, body) {
  const upstreamModel = resolveNanoGptImageModel(model);
  if (!upstreamModel) throw reject("NanoGPT image generation needs a model id such as qwen-image");
  if (!isRecord(body)) throw reject("NanoGPT image generation needs a JSON object");
  for (const [key, value] of Object.entries(body)) {
    if (present(value) && !ALLOWED_FIELDS.has(key)) throw reject(`NanoGPT image generation does not support ${key}`);
  }
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for NanoGPT image generation");
  if (body.prompt.length > NANOGPT_MAX_PROMPT_CHARS) throw reject(`NanoGPT image prompts must not exceed ${NANOGPT_MAX_PROMPT_CHARS} characters`);
  if (present(body.stream) && body.stream !== false) throw reject("NanoGPT image generation does not support streaming");

  const request = { model: upstreamModel, prompt: body.prompt };
  if (present(body.output_format)) {
    const format = isString(body.output_format) ? body.output_format.trim().toLowerCase() : "";
    if (!NANOGPT_OUTPUT_FORMATS.includes(format)) throw reject(`NanoGPT output_format must be one of: ${NANOGPT_OUTPUT_FORMATS.join(", ")}`);
    request.output_format = format;
  }
  if (present(body.n)) {
    if (!Number.isInteger(body.n) || body.n < 1 || body.n > NANOGPT_IMAGE_MAX_N) throw reject(`NanoGPT image generation takes n from 1 to ${NANOGPT_IMAGE_MAX_N}`);
    request.n = body.n;
  }
  if (present(body.size)) request.size = checkSize(body.size);
  if (present(body.quality)) {
    if (!isString(body.quality) || !WORD_RE.test(body.quality)) throw reject("NanoGPT image quality must be a short word");
    request.quality = body.quality;
  }
  if (present(body.response_format)) {
    if (!NANOGPT_RESPONSE_FORMATS.includes(body.response_format)) throw reject("NanoGPT image response_format must be url or b64_json");
    request.response_format = body.response_format;
  }
  if (present(body.style)) {
    if (!isString(body.style) || !WORD_RE.test(body.style)) throw reject("NanoGPT image style must be a short word");
    request.style = body.style;
  }
  return request;
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function nanoGptPublicUrl(raw) {
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
export function normalizeNanoGptImageItems(answer) {
  const raw = Array.isArray(answer?.data) ? answer.data : [];
  const items = [];
  const formats = new Set();
  let unsafe = 0;
  for (const item of raw.slice(0, NANOGPT_MAX_RESULTS * 2)) {
    if (items.length >= NANOGPT_MAX_RESULTS) break;
    if (!isRecord(item)) continue;
    if (isString(item.b64_json) && item.b64_json) {
      const format = BASE64_RE.test(item.b64_json) ? sniffImageFormat(item.b64_json) : undefined;
      if (MIME[format]) {
        items.push({ b64_json: item.b64_json, mime_type: MIME[format] });
        formats.add(format);
      } else unsafe += 1;
    } else if (isString(item.url) && item.url) {
      const url = nanoGptPublicUrl(item.url);
      if (url) items.push({ url });
      else unsafe += 1;
    }
  }
  return { items, formats, unsafe };
}

function refusedAnswer(response, secrets) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status === 401 || status === 403) {
    return createErrorResult(status, "NanoGPT rejected the API key", undefined, undefined, null, secrets);
  }
  if (status === 402) {
    return { ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "NanoGPT refused image generation for this account (insufficient balance)", undefined, undefined, null, secrets), quotaExhausted: true };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "NanoGPT rate limited image generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 404 || status === 410) {
    return createErrorResult(HTTP_STATUS.NOT_FOUND, `NanoGPT does not serve this image model (${status})`, undefined, undefined, null, secrets);
  }
  if (status >= 500) {
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `NanoGPT image generation failed with ${status}; whether it ran is unknown`, undefined, undefined, null, secrets), "submit-unknown");
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `NanoGPT refused the image request with ${status}`, undefined, undefined, null, secrets);
}

/**
 * @param {object} [options] - test seams and bounds: { fetchImpl, submitTimeoutMs, timeoutMs, now }
 */
export function createNanoGptImageAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = NANOGPT_SUBMIT_TIMEOUT_MS,
    timeoutMs = NANOGPT_TOTAL_TIMEOUT_MS,
    now = Date.now,
  } = options;

  return {
    provider: NANOGPT_PROVIDER_ID,
    aliases: NANOGPT_PROVIDER_ALIASES,
    models: NANOGPT_IMAGE_MODELS,
    supportedSizes: NANOGPT_IMAGE_SIZES,
    responseFormats: NANOGPT_RESPONSE_FORMATS,
    /**
     * Generate images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json, mime_type }] }`, or an error
     * result that carries `acceptedJob` when NanoGPT may have run the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildNanoGptImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const key = resolveNanoGptImageCredential(credentials);
      if (!key) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "NanoGPT API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = { apiKey: key, accessToken: credentials?.accessToken };
      const deadline = now() + timeoutMs;
      const left = deadline - now();
      if (left <= 0) return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "NanoGPT image request ran out of time before it was sent");

      let response;
      try {
        response = await boundedFetch(fetchImpl, NANOGPT_IMAGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: Math.min(submitTimeoutMs, left) });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NanoGPT image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `NanoGPT image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
        ), "submit-unknown");
      }
      if (isRedirect(response)) {
        // Never followed: the Bearer key stays on the fixed origin.
        discard(response);
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NanoGPT image request redirect refused");
      }
      if (offOrigin(response, NANOGPT_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NanoGPT image request was answered by another origin"), "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, secrets);

      let answer;
      try {
        const text = await readText(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: NANOGPT_RESPONSE_MAX_BYTES });
        answer = JSON.parse(text);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
        return withAcceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "NanoGPT returned an unreadable image response",
        ), "accepted");
      }
      const { items, formats, unsafe } = normalizeNanoGptImageItems(answer);
      if (items.length === 0) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          `NanoGPT image generation returned ${unsafe ? "no safe" : "no usable"} image`), "accepted");
      }
      if (request.output_format && formats.size > 0 && ![...formats].every((format) => format === request.output_format)) {
        log?.warn?.("IMAGE", `Image output format mismatch: requested ${request.output_format}, received ${[...formats].join(",")}`);
      }

      const created = Number.isInteger(answer?.created) && answer.created > 0 ? answer.created : Math.floor(now() / 1000);
      const payload = { created, data: items };
      if (items.every((item) => item.b64_json) && formats.size === 1) payload.output_format = [...formats][0];
      // Upstream usage (if any) becomes internal accounting tokens; cost stays unknown.
      const accounting = mediaAccounting(answer, NANOGPT_PROVIDER_ID, MODALITY);
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
