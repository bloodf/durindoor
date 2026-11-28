// Nebius Token Factory native image generation: one OpenAI-compatible JSON
// POST to https://api.tokenfactory.nebius.com/v1/images/generations with the
// selected connection's Bearer key, and the source's fallback host
// https://api.studio.nebius.com on a 404/410. Staged as a guarded `generate`
// adapter for IMAGE_ADAPTERS and not registered.
//
// Source contract (OmniRoute c71f0065 handleOpenAIImageGeneration, format
// "openai"): body { model, prompt } then output options, n, size, quality,
// response_format, style (each only when the caller set it); headers
// Content-Type application/json + Authorization Bearer; answer { created,
// data: [{ b64_json | url }], usage? }; a 2xx without a usable item is a 502;
// usage stays internal.
//
// Fork deviations: unsupported fields (input images, masks, backgrounds,
// animation frames, compression, streaming), gif/svg output and malformed
// n/size/model values are refused before anything is sent instead of being
// dropped or forwarded blindly; the fallback host is tried after 404/410 only
// (the source also replayed 502/503, which may follow accepted work);
// redirects are refused; every attempt has a deadline inside a total one and
// follows the caller's signal; error messages never quote the upstream body
// or the key; URLs must be public https and are never fetched; base64 items
// must decode as png/jpeg/webp; a submit whose outcome is unknown carries
// `acceptedJob` and is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { sniffImageFormat } from "../../../handlers/imageProviders/outputFormat.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NEBIUS_FALLBACK_ORIGIN, NEBIUS_FALLBACK_STATUSES, NEBIUS_IMAGE_FALLBACK_URL, NEBIUS_IMAGE_MAX_N, NEBIUS_IMAGE_MODELS,
  NEBIUS_IMAGE_SIZES, NEBIUS_IMAGE_URL, NEBIUS_MAX_PROMPT_CHARS, NEBIUS_MAX_RESULTS, NEBIUS_MAX_SIDE, NEBIUS_MIN_SIDE,
  NEBIUS_OUTPUT_FORMATS, NEBIUS_PRIMARY_ORIGIN, NEBIUS_PROVIDER_ALIASES, NEBIUS_PROVIDER_ID, NEBIUS_RESPONSE_FORMATS,
  NEBIUS_RESPONSE_MAX_BYTES, NEBIUS_SUBMIT_TIMEOUT_MS, NEBIUS_TOTAL_TIMEOUT_MS,
} from "./config.js";
import { boundedFetch, discard, isRedirect, isSafeNebiusModelId, offOrigin, provenUnsent, readText } from "./http.js";

const MODALITY = "image";
const MAX_URL_LENGTH = 4096;
const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;
const WORD_RE = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MIME = Object.freeze({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" });
const ALLOWED_FIELDS = new Set(["model", "prompt", "n", "size", "quality", "style", "response_format", "output_format", "user", "stream"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Nebius image request aborted");
const present = (value) => value !== undefined && value !== null;

/** Accounting for a submit Nebius may have run (and may bill) whose outcome is not known. */
export function nebiusAcceptedJob(jobState = "submit-unknown") {
  return { ...mediaAccounting(null, NEBIUS_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: nebiusAcceptedJob(jobState) });

/** The selected connection's key: source `credentials.apiKey || credentials.accessToken`. */
export function resolveNebiusImageCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The upstream model id, or null. Strips a `nebius/` prefix (the source
 * registry's id and alias). Like the source, any safe id passes through: the
 * registry model is a placeholder and Nebius decides what it serves.
 */
export function resolveNebiusImageModel(model) {
  if (!isString(model)) return null;
  let id = model.trim();
  if (id.startsWith(`${NEBIUS_PROVIDER_ID}/`)) id = id.slice(NEBIUS_PROVIDER_ID.length + 1);
  return isSafeNebiusModelId(id) ? id : null;
}

function checkSize(size) {
  if (!isString(size)) throw reject("Nebius image size must be a WIDTHxHEIGHT string");
  const match = SIZE_RE.exec(size);
  const ok = match && [match[1], match[2]].every((side) => Number(side) >= NEBIUS_MIN_SIDE && Number(side) <= NEBIUS_MAX_SIDE);
  if (!ok) throw reject(`Nebius image size must be WIDTHxHEIGHT with sides from ${NEBIUS_MIN_SIDE} to ${NEBIUS_MAX_SIDE}`);
  return size;
}

/**
 * The exact Nebius request body for an OpenAI-style image request, in the
 * source's field order. Throws a 400 error for anything this subset refuses.
 */
export function buildNebiusImageRequest(model, body) {
  const upstreamModel = resolveNebiusImageModel(model);
  if (!upstreamModel) throw reject("Nebius image generation needs a model id such as black-forest-labs/flux-schnell");
  if (!isRecord(body)) throw reject("Nebius image generation needs a JSON object");
  for (const [key, value] of Object.entries(body)) {
    if (present(value) && !ALLOWED_FIELDS.has(key)) throw reject(`Nebius image generation does not support ${key}`);
  }
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for Nebius image generation");
  if (body.prompt.length > NEBIUS_MAX_PROMPT_CHARS) throw reject(`Nebius image prompts must not exceed ${NEBIUS_MAX_PROMPT_CHARS} characters`);
  if (present(body.stream) && body.stream !== false) throw reject("Nebius image generation does not support streaming");

  const request = { model: upstreamModel, prompt: body.prompt };
  if (present(body.output_format)) {
    const format = isString(body.output_format) ? body.output_format.trim().toLowerCase() : "";
    if (!NEBIUS_OUTPUT_FORMATS.includes(format)) throw reject(`Nebius output_format must be one of: ${NEBIUS_OUTPUT_FORMATS.join(", ")}`);
    request.output_format = format;
  }
  if (present(body.n)) {
    if (!Number.isInteger(body.n) || body.n < 1 || body.n > NEBIUS_IMAGE_MAX_N) throw reject(`Nebius image generation takes n from 1 to ${NEBIUS_IMAGE_MAX_N}`);
    request.n = body.n;
  }
  if (present(body.size)) request.size = checkSize(body.size);
  if (present(body.quality)) {
    if (!isString(body.quality) || !WORD_RE.test(body.quality)) throw reject("Nebius image quality must be a short word");
    request.quality = body.quality;
  }
  if (present(body.response_format)) {
    if (!NEBIUS_RESPONSE_FORMATS.includes(body.response_format)) throw reject("Nebius image response_format must be url or b64_json");
    request.response_format = body.response_format;
  }
  if (present(body.style)) {
    if (!isString(body.style) || !WORD_RE.test(body.style)) throw reject("Nebius image style must be a short word");
    request.style = body.style;
  }
  return request;
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function nebiusPublicUrl(raw) {
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
export function normalizeNebiusImageItems(answer) {
  const raw = Array.isArray(answer?.data) ? answer.data : [];
  const items = [];
  const formats = new Set();
  let unsafe = 0;
  for (const item of raw.slice(0, NEBIUS_MAX_RESULTS * 2)) {
    if (items.length >= NEBIUS_MAX_RESULTS) break;
    if (!isRecord(item)) continue;
    if (isString(item.b64_json) && item.b64_json) {
      const format = BASE64_RE.test(item.b64_json) ? sniffImageFormat(item.b64_json) : undefined;
      if (MIME[format]) {
        items.push({ b64_json: item.b64_json, mime_type: MIME[format] });
        formats.add(format);
      } else unsafe += 1;
    } else if (isString(item.url) && item.url) {
      const url = nebiusPublicUrl(item.url);
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
    return createErrorResult(status, "Nebius rejected the API key", undefined, undefined, null, secrets);
  }
  if (status === 402) {
    return { ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "Nebius refused image generation for this account (out of credit)", undefined, undefined, null, secrets), quotaExhausted: true };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "Nebius rate limited image generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 404 || status === 410) {
    return createErrorResult(HTTP_STATUS.NOT_FOUND, `Nebius does not serve this image model (${status})`, undefined, undefined, null, secrets);
  }
  if (status >= 500) {
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Nebius image generation failed with ${status}; whether it ran is unknown`, undefined, undefined, null, secrets), "submit-unknown");
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Nebius refused the image request with ${status}`, undefined, undefined, null, secrets);
}

/**
 * @param {object} [options] - test seams and bounds: { fetchImpl, submitTimeoutMs, timeoutMs, now }
 */
export function createNebiusImageAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = NEBIUS_SUBMIT_TIMEOUT_MS,
    timeoutMs = NEBIUS_TOTAL_TIMEOUT_MS,
    now = Date.now,
  } = options;

  return {
    provider: NEBIUS_PROVIDER_ID,
    aliases: NEBIUS_PROVIDER_ALIASES,
    models: NEBIUS_IMAGE_MODELS,
    supportedSizes: NEBIUS_IMAGE_SIZES,
    responseFormats: NEBIUS_RESPONSE_FORMATS,
    /**
     * Generate images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json, mime_type }] }`, or an error
     * result that carries `acceptedJob` when Nebius may have run the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildNebiusImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const key = resolveNebiusImageCredential(credentials);
      if (!key) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Nebius API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = { apiKey: key, accessToken: credentials?.accessToken };
      const proxyOptions = resolveCredentialProxyOptions(credentials);
      const deadline = now() + timeoutMs;
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(request),
        redirect: "manual",
        proxyOptions,
      };

      const attempts = [[NEBIUS_IMAGE_URL, NEBIUS_PRIMARY_ORIGIN], [NEBIUS_IMAGE_FALLBACK_URL, NEBIUS_FALLBACK_ORIGIN]];
      let response;
      for (const [index, [url, origin]] of attempts.entries()) {
        if (signal?.aborted) return abortedResult();
        const left = deadline - now();
        if (left <= 0) return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "Nebius image request ran out of time before it was sent");
        try {
          response = await boundedFetch(fetchImpl, url, init, { signal, timeoutMs: Math.min(submitTimeoutMs, left) });
        } catch (error) {
          const unsent = provenUnsent(error);
          if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
          if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Nebius image request could not connect");
          const timedOut = error?.name === "TimeoutError";
          return withAcceptedJob(createErrorResult(
            timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
            `Nebius image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
          ), "submit-unknown");
        }
        if (isRedirect(response)) {
          // Never followed: the Bearer key stays on the two fixed origins.
          discard(response);
          return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Nebius image request redirect refused");
        }
        if (offOrigin(response, origin)) {
          discard(response);
          return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Nebius image request was answered by another origin"), "submit-unknown");
        }
        if (index === 0 && NEBIUS_FALLBACK_STATUSES.includes(response.status)) {
          // Provably not run on the primary host: the source fallback host is tried once.
          log?.info?.("IMAGE", `nebius: primary URL failed (${response.status}), trying fallback`);
          discard(response);
          continue;
        }
        break;
      }
      if (!response.ok) return refusedAnswer(response, secrets);

      let answer;
      try {
        const text = await readText(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: NEBIUS_RESPONSE_MAX_BYTES });
        answer = JSON.parse(text);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
        return withAcceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "Nebius returned an unreadable image response",
        ), "accepted");
      }
      const { items, formats, unsafe } = normalizeNebiusImageItems(answer);
      if (items.length === 0) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          `Nebius image generation returned ${unsafe ? "no safe" : "no usable"} image`), "accepted");
      }
      if (request.output_format && formats.size > 0 && ![...formats].every((format) => format === request.output_format)) {
        log?.warn?.("IMAGE", `Image output format mismatch: requested ${request.output_format}, received ${[...formats].join(",")}`);
      }

      const created = Number.isInteger(answer?.created) && answer.created > 0 ? answer.created : Math.floor(now() / 1000);
      const payload = { created, data: items };
      const allB64 = items.every((item) => item.b64_json);
      if (allB64 && formats.size === 1) payload.output_format = [...formats][0];
      // Upstream usage (if any) becomes internal accounting tokens; cost stays unknown.
      const accounting = mediaAccounting(answer, NEBIUS_PROVIDER_ID, MODALITY);
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
