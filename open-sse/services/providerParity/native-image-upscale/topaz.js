// Topaz Labs native upscale: one synchronous multipart POST to
// https://api.topazlabs.com/image/v1/enhance answered with the image bytes.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale/topaz.ts
// handleTopazImageUpscale): X-API-Key (apiKey, else accessToken) and
// `Accept: image/<output_format>`; form fields in order image (blob, file
// name "image"), output_format (png | jpeg | webp, jpg = jpeg, default png),
// output_width / output_height (explicit `size` / `output_size` "WxH", else
// the source dimensions times the factor), model (`topaz_model`), sharpen,
// denoise, fix_compression (0-1, rounded to 2 decimals), face_enhancement and,
// only when it is on, face_enhancement_creativity (`creativity` or
// `face_enhancement_creativity`, a 0-100 percent is divided by 100) and
// face_enhancement_strength. The factor (default 2) comes from the source
// factor aliases.
//
// Fork deviations: a factor other than 2 or 4, an output larger than the
// source's 16000-pixel edge (the source clamped it), `size` together with a
// factor (the source silently ignored the factor), a factor on a source whose
// dimensions cannot be read (the source silently dropped it), out-of-range or
// non-numeric strengths (the source clamped or skipped them), creativity or
// strength without face enhancement (the source dropped them), a prompt (the
// source ignored it) and unknown output formats (the source used png) are
// refused before submit. The answer must sniff as the requested output
// format. Redirects and foreign-origin answers are refused, the upstream body
// is never quoted, and a submit whose outcome is unknown carries
// `acceptedJob` and is never resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBoolean, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEFAULT_UPSCALE_FACTOR, FACTOR_FIELDS, IMAGE_MIMES, RESULT_MAX_BYTES, SUBMIT_TIMEOUT_MS, TOPAZ_ENHANCE_URL, TOPAZ_MAX_OUTPUT_EDGE,
  TOPAZ_ORIGIN, TOPAZ_PROVIDER_ID, TOPAZ_UPLOAD_FILENAME, TOTAL_TIMEOUT_MS, UPSCALE_PROVIDERS,
} from "./config.js";
import { boundedFetch, discard, offOrigin, readBoundedBytes, refusedAnswer, sendFailure, withAcceptedJob } from "./http.js";
import { extractUpscaleSourceImage, imageEntry, reject, resolveSourceImage, sniffUpscaleImage } from "./media.js";
import {
  COMMON_FIELDS, assertKnownFields, numeric, parseEnvelope, parseFactor, parseOutputFormat, present, readAliased,
} from "./request.js";
import { upscaleSuccess } from "./result.js";

const LABEL = "Topaz Labs upscale";
const SIZE_RE = /^\s*([1-9]\d{0,5})\s*[x×]\s*([1-9]\d{0,5})\s*$/i;
const ALLOWED = new Set([
  ...COMMON_FIELDS, ...FACTOR_FIELDS, "size", "output_size", "output_format", "format", "topaz_model", "sharpen", "denoise",
  "fix_compression", "face_enhancement", "creativity", "face_enhancement_creativity", "face_enhancement_strength",
]);
const BOOL_WORDS = Object.freeze({ true: true, "1": true, yes: true, on: true, false: false, "0": false, no: false, off: false });

/** Source credential order: apiKey, else accessToken (trimmed). */
export function resolveTopazUpscaleCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

function unitFloat(value, field, percentAware = false) {
  let n = numeric(value);
  if (n === null) throw reject(`${LABEL} ${field} must be a number from 0 to 1`);
  if (percentAware && n > 1) n /= 100;
  if (n < 0 || n > 1) throw reject(`${LABEL} ${field} must be from 0 to 1${percentAware ? " (or 0-100 %)" : ""}`);
  return Math.round(n * 100) / 100;
}

function parseBool(value, field) {
  if (isBoolean(value)) return value;
  const word = String(value ?? "").trim().toLowerCase();
  if (Object.hasOwn(BOOL_WORDS, word)) return BOOL_WORDS[word];
  throw reject(`${LABEL} ${field} must be a boolean`);
}

/**
 * Validate an upscale body for topaz/topaz-enhance. Throws 400 before any
 * network call. The source image itself is resolved by the adapter.
 */
export function parseTopazUpscaleRequest(model, body) {
  const entry = UPSCALE_PROVIDERS[TOPAZ_PROVIDER_ID].models.find((row) => row.id === model);
  if (!entry) throw reject(`Unsupported Topaz Labs upscale model: ${model}`);
  assertKnownFields(body, ALLOWED, LABEL);
  const responseFormat = parseEnvelope(body, LABEL);
  const source = extractUpscaleSourceImage(body, `Topaz Labs upscale model ${model}`);
  const factor = parseFactor(body, entry, { label: LABEL });
  const outputFormat = parseOutputFormat(body, LABEL);

  let size = null;
  const sizeField = readAliased(body, ["size", "output_size"], LABEL);
  if (sizeField) {
    const match = isString(sizeField.value) ? SIZE_RE.exec(sizeField.value) : null;
    const width = match ? Number(match[1]) : 0;
    const height = match ? Number(match[2]) : 0;
    if (!match || width > TOPAZ_MAX_OUTPUT_EDGE || height > TOPAZ_MAX_OUTPUT_EDGE) {
      throw reject(`${LABEL} ${sizeField.field} must be WIDTHxHEIGHT with sides from 1 to ${TOPAZ_MAX_OUTPUT_EDGE}`);
    }
    if (factor !== null) throw reject(`${LABEL} takes either ${sizeField.field} or a factor, not both`);
    size = { width, height };
  }

  const fields = [];
  if (present(body.topaz_model)) {
    if (!isString(body.topaz_model) || body.topaz_model.trim().length > 100) throw reject(`${LABEL} topaz_model must be a model name`);
    fields.push(["model", body.topaz_model.trim()]);
  }
  for (const key of ["sharpen", "denoise", "fix_compression"]) {
    if (present(body[key])) fields.push([key, unitFloat(body[key], key)]);
  }
  const creativity = readAliased(body, ["creativity", "face_enhancement_creativity"], LABEL);
  const faceOn = present(body.face_enhancement) ? parseBool(body.face_enhancement, "face_enhancement") : null;
  if (faceOn !== null) fields.push(["face_enhancement", faceOn]);
  if (faceOn !== true && (creativity || present(body.face_enhancement_strength))) {
    throw reject(`${LABEL} creativity and face_enhancement_strength apply only with face_enhancement: true`);
  }
  if (faceOn === true) {
    if (creativity) fields.push(["face_enhancement_creativity", unitFloat(creativity.value, creativity.field, true)]);
    if (present(body.face_enhancement_strength)) fields.push(["face_enhancement_strength", unitFloat(body.face_enhancement_strength, "face_enhancement_strength")]);
  }
  return { model, entry, source, factor, size, outputFormat, responseFormat, fields };
}

/**
 * Output size: explicit size, else source dimensions × factor (default 2).
 * Null when no factor was sent and the dimensions are unknown (Topaz default).
 */
export function topazTargetSize(request, image) {
  if (request.size) return { target: request.size, factor: null };
  const factor = request.factor ?? DEFAULT_UPSCALE_FACTOR;
  const dims = image.dimensions;
  if (!dims) {
    if (request.factor !== null) throw reject(`${LABEL} cannot apply factor ${factor}: the source image dimensions are unreadable`);
    return { target: null, factor: null };
  }
  const target = { width: dims.width * factor, height: dims.height * factor };
  if (target.width > TOPAZ_MAX_OUTPUT_EDGE || target.height > TOPAZ_MAX_OUTPUT_EDGE) {
    throw reject(`${LABEL} output ${target.width}x${target.height} exceeds the ${TOPAZ_MAX_OUTPUT_EDGE}-pixel edge limit`);
  }
  return { target, factor };
}

/** The exact source multipart form. */
export function buildTopazUpscaleForm(request, image, target) {
  const form = new FormData();
  form.append("image", new Blob([image.bytes], { type: image.mime }), TOPAZ_UPLOAD_FILENAME);
  form.append("output_format", request.outputFormat);
  if (target) {
    form.append("output_width", String(target.width));
    form.append("output_height", String(target.height));
  }
  for (const [key, value] of request.fields) form.append(key, String(value));
  return form;
}

export const buildTopazUpscaleHeaders = (token, outputFormat) => ({ Accept: `image/${outputFormat}`, "X-API-Key": token });

/** @param {object} [options] - { fetchImpl, sourceFetchImpl, submitTimeoutMs, timeoutMs, now } */
export function createTopazUpscaleAdapter(options = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args), sourceFetchImpl, submitTimeoutMs = SUBMIT_TIMEOUT_MS,
    timeoutMs = TOTAL_TIMEOUT_MS, now = Date.now,
  } = options;
  const provider = TOPAZ_PROVIDER_ID;
  return {
    provider,
    format: UPSCALE_PROVIDERS[provider].format,
    models: UPSCALE_PROVIDERS[provider].models,
    async upscale({ model, body, credentials, signal, log }) {
      let request;
      let image;
      let size;
      try {
        request = parseTopazUpscaleRequest(model, body);
        const token = resolveTopazUpscaleCredential(credentials);
        if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Missing Topaz Labs API key");
        const sourceOptions = { signal };
        if (sourceFetchImpl) sourceOptions.fetchImpl = sourceFetchImpl;
        image = await resolveSourceImage(request.source, sourceOptions);
        size = topazTargetSize(request, image);
        request.token = token;
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const deadline = now() + timeoutMs;
      log?.info?.("IMAGE", `${provider}/${model} (topaz upscale) | ${size.factor ?? "default"}x | output=${request.outputFormat}`);

      let response;
      try {
        response = await boundedFetch(fetchImpl, TOPAZ_ENHANCE_URL, {
          method: "POST",
          headers: buildTopazUpscaleHeaders(request.token, request.outputFormat),
          body: buildTopazUpscaleForm(request, image, size.target),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: Math.min(submitTimeoutMs, timeoutMs) });
      } catch (error) {
        return sendFailure(error, { provider, label: "Topaz Labs", signal });
      }
      if (offOrigin(response, TOPAZ_ORIGIN)) {
        discard(response);
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Topaz Labs upscale was redirected or answered by another origin (refused)"), provider, "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(response, { provider, label: "Topaz Labs", credentials });

      let bytes;
      try {
        bytes = await readBoundedBytes(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: RESULT_MAX_BYTES });
      } catch (error) {
        const aborted = signal?.aborted || error?.name === "AbortError";
        return withAcceptedJob(createErrorResult(
          aborted ? 499 : error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          aborted ? "Topaz Labs upscale aborted after it was accepted" : error?.tooLarge ? "Topaz Labs returned an image larger than the gateway accepts" : "Topaz Labs returned an unreadable image",
        ), provider, "accepted");
      }
      const format = sniffUpscaleImage(bytes);
      if (format !== request.outputFormat) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY,
          `Topaz Labs upscale returned ${format ?? "no valid image"}, not the requested ${request.outputFormat}`), provider, "accepted");
      }
      const meta = { factor: size.factor, output_format: format, mime: IMAGE_MIMES[format] };
      if (size.target) {
        meta.width = size.target.width;
        meta.height = size.target.height;
      }
      return upscaleSuccess({
        provider, model, now,
        images: [imageEntry(bytes, format, request.responseFormat)],
        meta,
      });
    },
  };
}
