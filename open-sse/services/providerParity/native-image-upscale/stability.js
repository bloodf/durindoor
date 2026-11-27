// Stability AI native upscale: /v2beta/stable-image/upscale/{fast,conservative,creative}.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale/stability.ts
// handleStabilityImageUpscale): `Authorization: Bearer <apiKey|accessToken>`,
// `Accept: application/json`; multipart fields in order image (blob, file
// name "image"), output_format (png | jpeg | webp, jpg = jpeg, default png),
// prompt, negative_prompt, creativity, seed, style_preset. `fast` is a fixed
// 4x pass without prompt; `conservative` (creativity 0.2-0.5, default 0.35)
// and `creative` (0-0.35, default 0.3) require a prompt. A creativity in
// (0, 1) is a native float; anything else is a 0-100 percent mapped linearly
// into the range and rounded to 2 decimals. `creative` is async: the submit
// answers `{ id }`, then GET /v2beta/results/{id} answers 202 while running
// (polled every 3 s, 429/5xx retried, default deadline 300 s or `timeout_ms`)
// and 200 with `{ image, finish_reason, seed }`. CONTENT_FILTERED is an error.
//
// Fork deviations: per Stability's endpoint docs (the source sent them to
// every model) fast takes no prompt, negative_prompt, creativity, seed or
// style_preset, and conservative takes no style_preset. A factor other than
// 4, a size, a creativity outside its range (the source clamped it) or not
// numeric (the source used the default), a seed outside 0..4294967294 and an
// unknown output format are refused before submit. The result must decode to
// the requested output format; the results answer's `image` is read, with
// `result` accepted as the documented results-endpoint name. Once a creative
// job id is held every later failure carries `acceptedJob` (with the job id)
// and the job is never resubmitted; poll redirects are refused.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  FACTOR_FIELDS, IMAGE_MIMES, STABILITY_CREATIVITY, STABILITY_ENDPOINTS, STABILITY_JSON_MAX_BYTES, STABILITY_ORIGIN,
  STABILITY_POLL_INTERVAL_MS, STABILITY_PROVIDER_ID, STABILITY_RESULT_TIMEOUT_MS, STABILITY_UPLOAD_FILENAME, SUBMIT_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS, UPSCALE_PROVIDERS, stabilityResultUrl, CREATIVITY_FIELDS,
} from "./config.js";
import {
  abortableSleep, boundedFetch, discard, offOrigin, readBoundedJson, refusedAnswer, sendFailure, withAcceptedJob,
} from "./http.js";
import { extractUpscaleSourceImage, imageEntry, reject, resolveSourceImage, sniffUpscaleImage } from "./media.js";
import {
  COMMON_FIELDS, assertKnownFields, numeric, parseEnvelope, parseFactor, parseOutputFormat, parsePrompt, parseTimeoutOverride,
  present, readCreativity,
} from "./request.js";
import { upscaleSuccess } from "./result.js";

const LABEL = "Stability AI upscale";
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SEED = 4_294_967_294;
/** Optional fields each model takes besides the image and output format. */
const MODEL_FIELDS = Object.freeze({
  fast: Object.freeze([]),
  conservative: Object.freeze(["prompt", "negative_prompt", ...CREATIVITY_FIELDS, "seed"]),
  creative: Object.freeze(["prompt", "negative_prompt", ...CREATIVITY_FIELDS, "seed", "style_preset", "timeout_ms"]),
});
const ASYNC_MODELS = new Set(["creative"]);

export function resolveStabilityUpscaleCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/** Map a creativity request onto the model's documented float range (source mapCreativity). */
export function mapStabilityCreativity(found, range) {
  if (!found) return range.fallback;
  const n = numeric(found.value);
  if (n === null) throw reject(`${LABEL} ${found.field} must be a number`);
  const round2 = (value) => Math.round(value * 100) / 100;
  if (n > 0 && n < 1) {
    if (n < range.min || n > range.max) throw reject(`${LABEL} ${found.field} ${n} is outside ${range.min}-${range.max} (or 0-100 %)`);
    return round2(n);
  }
  if (n < 0 || n > 100) throw reject(`${LABEL} ${found.field} must be a ${range.min}-${range.max} float or a 0-100 percent`);
  return round2(range.min + ((range.max - range.min) * n) / 100);
}

/** Validate an upscale body for stability-ai/{fast,conservative,creative}. Throws 400. */
export function parseStabilityUpscaleRequest(model, body) {
  const entry = UPSCALE_PROVIDERS[STABILITY_PROVIDER_ID].models.find((row) => row.id === model);
  if (!entry || !STABILITY_ENDPOINTS[model]) throw reject(`Unsupported Stability AI upscale model: ${model}. Use fast, conservative or creative.`);
  const label = `${LABEL} (${model})`;
  assertKnownFields(body, new Set([...COMMON_FIELDS, ...FACTOR_FIELDS, "output_format", "format", ...MODEL_FIELDS[model]]), label);
  const responseFormat = parseEnvelope(body, label);
  const source = extractUpscaleSourceImage(body, `Stability AI upscale model ${model}`);
  parseFactor(body, entry, { label });
  const outputFormat = parseOutputFormat(body, label);
  const prompt = parsePrompt(body);
  if (entry.promptRequired && !prompt) {
    throw reject(`Stability AI "${model}" upscale requires a prompt describing the image. Use the "fast" model for a prompt-free 4x upscale.`);
  }
  const negativePrompt = parsePrompt(body, "negative_prompt");
  const range = STABILITY_CREATIVITY[model];
  const creativity = range ? mapStabilityCreativity(readCreativity(body, label), range) : null;
  let seed;
  if (present(body.seed)) {
    seed = numeric(body.seed);
    if (seed === null || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw reject(`${label} seed must be an integer from 0 to ${MAX_SEED}`);
  }
  let stylePreset;
  if (present(body.style_preset)) {
    if (!isString(body.style_preset)) throw reject(`${label} style_preset must be a string`);
    stylePreset = body.style_preset.trim();
  }
  const timeoutMs = ASYNC_MODELS.has(model) ? parseTimeoutOverride(body, label) : null;
  return { model, entry, source, outputFormat, responseFormat, prompt, negativePrompt, creativity, seed, stylePreset, timeoutMs };
}

/** The exact source multipart form. */
export function buildStabilityUpscaleForm(request, image) {
  const form = new FormData();
  form.append("image", new Blob([image.bytes], { type: image.mime }), STABILITY_UPLOAD_FILENAME);
  form.append("output_format", request.outputFormat);
  if (request.prompt) form.append("prompt", request.prompt);
  if (request.negativePrompt) form.append("negative_prompt", request.negativePrompt);
  if (request.creativity !== null) form.append("creativity", String(request.creativity));
  if (request.seed !== undefined) form.append("seed", String(request.seed));
  if (request.stylePreset) form.append("style_preset", request.stylePreset);
  return form;
}

export const buildStabilityHeaders = (token) => ({ Accept: "application/json", Authorization: `Bearer ${token}` });

/** @param {object} [options] - { fetchImpl, sourceFetchImpl, submitTimeoutMs, timeoutMs, pollIntervalMs, resultTimeoutMs, now, sleep } */
export function createStabilityUpscaleAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args), sourceFetchImpl, submitTimeoutMs = SUBMIT_TIMEOUT_MS, timeoutMs = TOTAL_TIMEOUT_MS,
    pollIntervalMs = STABILITY_POLL_INTERVAL_MS, resultTimeoutMs = STABILITY_RESULT_TIMEOUT_MS, now = Date.now, sleep = abortableSleep,
  } = options;
  const provider = STABILITY_PROVIDER_ID;

  /** Read a 2xx JSON envelope; failures are lost results of accepted work. */
  async function readEnvelope(response, { signal, deadline, jobId }) {
    try {
      const value = await readBoundedJson(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: STABILITY_JSON_MAX_BYTES });
      if (!isRecord(value)) throw Object.assign(new Error("not an object"), { invalidJson: true });
      return { value };
    } catch (error) {
      const aborted = signal?.aborted || error?.name === "AbortError";
      return {
        failure: withAcceptedJob(createErrorResult(
          aborted ? 499 : error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          aborted ? "Stability AI upscale aborted after it was accepted" : "Stability AI returned an unreadable upscale answer",
        ), provider, "accepted", jobId ? { jobId } : {}),
      };
    }
  }

  async function pollResult({ token, jobId, signal, deadline, credentials }) {
    const lost = (status, message) => ({ failure: withAcceptedJob(createErrorResult(status, message), provider, "accepted", { jobId }) });
    for (let attempt = 1; ; attempt += 1) {
      if (now() >= deadline) return lost(HTTP_STATUS.GATEWAY_TIMEOUT, "Stability AI creative upscale timed out");
      let response;
      try {
        response = await boundedFetch(fetchImpl, stabilityResultUrl(jobId), {
          method: "GET", headers: buildStabilityHeaders(token), redirect: "manual", proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: Math.max(1, Math.min(submitTimeoutMs, deadline - now())) });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return lost(499, "Stability AI creative upscale aborted after it was accepted");
        if (error?.name === "TimeoutError") return lost(HTTP_STATUS.GATEWAY_TIMEOUT, "Stability AI creative upscale timed out");
        return lost(HTTP_STATUS.BAD_GATEWAY, "Stability AI creative upscale result could not be fetched");
      }
      if (offOrigin(response, STABILITY_ORIGIN)) {
        discard(response);
        return lost(HTTP_STATUS.BAD_GATEWAY, "Stability AI result poll was redirected (refused)");
      }
      if (response.status === 202 || response.status === 429 || response.status >= 500) {
        discard(response);
        try {
          await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())), signal);
        } catch {
          return lost(499, "Stability AI creative upscale aborted after it was accepted");
        }
        continue;
      }
      if (!response.ok) {
        discard(response);
        return lost(HTTP_STATUS.BAD_GATEWAY, `Stability AI upscale result failed (${response.status})`);
      }
      return readEnvelope(response, { signal, deadline, jobId });
    }
  }

  return {
    provider,
    format: UPSCALE_PROVIDERS[provider].format,
    models: UPSCALE_PROVIDERS[provider].models,
    async upscale({ model, body, credentials, signal, log }) {
      let request;
      let image;
      let token;
      try {
        request = parseStabilityUpscaleRequest(model, body);
        token = resolveStabilityUpscaleCredential(credentials);
        if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Missing Stability AI API key");
        image = await resolveSourceImage(request.source, { signal, ...(sourceFetchImpl ? { fetchImpl: sourceFetchImpl } : {}) });
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const started = now();
      const deadline = started + Math.min(timeoutMs, ASYNC_MODELS.has(model) ? (request.timeoutMs ?? resultTimeoutMs) + submitTimeoutMs : timeoutMs);
      log?.info?.("IMAGE", `${provider}/${model} (stability upscale)${request.creativity !== null ? ` | creativity=${request.creativity}` : ""} | output=${request.outputFormat}`);

      let response;
      try {
        response = await boundedFetch(fetchImpl, `${STABILITY_ORIGIN}${STABILITY_ENDPOINTS[model]}`, {
          method: "POST", headers: buildStabilityHeaders(token), body: buildStabilityUpscaleForm(request, image), redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: Math.min(submitTimeoutMs, timeoutMs) });
      } catch (error) {
        return sendFailure(error, { provider, label: "Stability AI", signal });
      }
      if (offOrigin(response, STABILITY_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Stability AI upscale was redirected or answered by another origin (refused)"), provider, "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, { provider, label: "Stability AI", credentials });

      let envelope = await readEnvelope(response, { signal, deadline });
      if (envelope.failure) return envelope.failure;
      let jobId;
      if (ASYNC_MODELS.has(model) && isString(envelope.value.id) && envelope.value.id) {
        jobId = envelope.value.id;
        if (!JOB_ID_RE.test(jobId)) {
          return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Stability AI returned an unusable job id"), provider, "accepted");
        }
        const pollDeadline = Math.min(deadline, now() + (request.timeoutMs ?? resultTimeoutMs));
        envelope = await pollResult({ token, jobId, signal, deadline: pollDeadline, credentials });
        if (envelope.failure) return envelope.failure;
      }
      const final = envelope.value;
      const jobMeta = jobId ? { jobId } : {};
      if (String(final.finish_reason ?? "").toUpperCase() === "CONTENT_FILTERED") {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_REQUEST, "Stability AI filtered the upscale result (CONTENT_FILTERED)"), provider, "filtered", jobMeta);
      }
      const base64 = isString(final.image) ? final.image : isString(final.result) ? final.result : "";
      const clean = base64.replace(/\s/g, "");
      const bytes = clean && clean.length % 4 === 0 && BASE64_RE.test(clean) ? new Uint8Array(Buffer.from(clean, "base64")) : null;
      const format = bytes ? sniffUpscaleImage(bytes) : null;
      if (format !== request.outputFormat) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          bytes ? `Stability AI upscale returned ${format ?? "no valid image"}, not the requested ${request.outputFormat}` : "Stability AI upscale returned no image"),
        provider, "accepted", jobMeta);
      }
      return upscaleSuccess({
        provider, model, now,
        images: [imageEntry(bytes, format, request.responseFormat)],
        meta: {
          factor: 4,
          output_format: format,
          mime: IMAGE_MIMES[format],
          ...(request.creativity !== null ? { creativity: request.creativity } : {}),
          ...(final.seed !== undefined ? { seed: final.seed } : {}),
        },
        accountingMeta: jobMeta,
      });
    },
  };
}
