// Source image intake and result image shaping for the staged upscale route.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale/shared.ts):
// extractUpscaleSourceImage walks 14 body aliases (then the same keys under
// `provider_options`, then chat-style `messages` image parts) and takes the
// first candidate; resolveUpscaleImageSource decodes a data: URL, fetches an
// http(s) URL through fetchUntrustedRemoteImage (public-only, DNS pinned) or
// decodes bare base64, capped at 20 MiB; buildUpscaleImageEntry returns
// `{ b64_json }` or `{ url: data:<mime>;base64,… }`.
//
// Fork deviations: more than one distinct source image is refused instead of
// silently using the first; a message part that is not an image (its text
// would be dropped) is refused; the source bytes must sniff as PNG, JPEG or
// WebP and a data: MIME that contradicts them is refused (the source trusted
// the declared type); remote sources go through the local safe media
// transport — fetchPublic (every hop re-validated, at most three redirects)
// over guardedProbeFetch("public-only") (blocked literals refused before a
// socket opens, connection-time DNS answers pinned and checked) — with no
// credential, cookie or vendor header, a deadline, the caller's signal and the
// source byte cap; result data: URLs use the sniffed type, never a vendor
// Content-Type.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { sniffImageDimensions, sniffImageFormat } from "../../../utils/imageSniff.js";
import { guardedProbeFetch } from "../../../utils/outboundUrlGuard.js";
import { fetchPublic, isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  IMAGE_MIMES, MAX_UPSCALE_SOURCE_BYTES, MAX_URL_CHARS, MIN_IMAGE_BYTES, SOURCE_FETCH_MAX_REDIRECTS,
  SOURCE_FETCH_TIMEOUT_MS, SOURCE_IMAGE_FIELDS,
} from "./config.js";
import { boundedFetch, discard, readBoundedBytes } from "./http.js";

export const reject = (message, status = HTTP_STATUS.BAD_REQUEST) => Object.assign(new Error(message), { status });
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URI_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;charset=[^;,]+)?;base64,(.*)$/is;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const IMAGE_PART_TYPES = new Set(["image_url", "image"]);

/** "png" | "jpeg" | "webp" for bytes of an accepted container, else null. */
export function sniffUpscaleImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < MIN_IMAGE_BYTES) return null;
  const format = sniffImageFormat(bytes);
  return format && IMAGE_MIMES[format] ? format : null;
}

/** Candidate strings of one value, in source order (firstImageCandidate shapes). */
function candidatesOf(value, field, into) {
  if (value === undefined || value === null) return;
  if (isString(value)) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== "null" && trimmed !== "undefined" && !into.includes(trimmed)) into.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) candidatesOf(item, field, into);
    return;
  }
  if (isRecord(value)) {
    if (isString(value.url)) return candidatesOf(value.url, field, into);
    if (isString(value.image_url)) return candidatesOf(value.image_url, field, into);
    if (isRecord(value.image_url)) return candidatesOf(value.image_url.url, field, into);
    if (isString(value.b64_json)) return candidatesOf(`data:image/png;base64,${value.b64_json}`, field, into);
    if (isString(value.base64)) return candidatesOf(`data:image/png;base64,${value.base64}`, field, into);
  }
  throw reject(`Upscale ${field} is not an image reference`);
}

/**
 * Every distinct source image reference of a body, in source field order.
 * Throws 400 for a malformed reference or a non-image chat part.
 */
export function collectUpscaleSourceImages(body) {
  const found = [];
  const options = isRecord(body.provider_options) ? body.provider_options : {};
  for (const key of SOURCE_IMAGE_FIELDS) {
    candidatesOf(body[key], key, found);
    candidatesOf(options[key], `provider_options.${key}`, found);
  }
  if (body.messages !== undefined && body.messages !== null) {
    if (!Array.isArray(body.messages)) throw reject("Upscale messages must be an array");
    for (const message of body.messages) {
      const content = isRecord(message) ? message.content : undefined;
      if (!Array.isArray(content)) throw reject("Upscale messages may carry image parts only");
      for (const part of content) {
        if (!isRecord(part) || !IMAGE_PART_TYPES.has(part.type)) throw reject("Upscale messages may carry image parts only");
        candidatesOf(part.image_url ?? part.image ?? part.url, "messages image part", found);
      }
    }
  }
  return found;
}

/** The single source image reference, or a 400 for none / several. */
export function extractUpscaleSourceImage(body, label) {
  const found = collectUpscaleSourceImages(body);
  if (found.length === 0) throw reject(`${label} requires a source image`);
  if (found.length > 1) throw reject(`${label} takes exactly one source image (${found.length} distinct were given)`);
  return found[0];
}

/** An http(s) URL with a public literal host and no userinfo, or null. */
export function parsePublicHttpUrl(raw, { httpsOnly = false } = {}) {
  if (!isString(raw) || raw.length > MAX_URL_CHARS || /[\s\0]/.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const schemes = httpsOnly ? ["https:"] : ["https:", "http:"];
  if (!schemes.includes(url.protocol) || url.username || url.password || !url.hostname || isBlockedHost(url.hostname)) return null;
  return url;
}

/** Whether the reference is a remote (scheme://) URL rather than inline data. */
export const isRemoteReference = (source) => SCHEME_RE.test(source) && !source.toLowerCase().startsWith("data:");

function checkImageBytes(bytes, declared, maxBytes) {
  if (bytes.byteLength === 0) throw reject("Source image decoded to empty bytes");
  if (bytes.byteLength > maxBytes) throw reject(`Source image must not exceed ${maxBytes} bytes`);
  const format = sniffUpscaleImage(bytes);
  if (!format) throw reject("Source image must be a PNG, JPEG or WebP");
  const mime = IMAGE_MIMES[format];
  if (declared && declared !== mime && !(format === "jpeg" && declared === "image/jpg")) {
    throw reject(`Source image is ${format}, not the declared ${declared}`);
  }
  return { bytes, format, mime, dimensions: sniffImageDimensions(bytes) ?? null };
}

/** Decode a data: URI or bare base64 source. URLs are not handled here. */
export function decodeInlineImage(source, maxBytes = MAX_UPSCALE_SOURCE_BYTES) {
  const trimmed = String(source ?? "").trim();
  let declared = null;
  let base64 = trimmed;
  const match = DATA_URI_RE.exec(trimmed);
  if (match) {
    declared = match[1].toLowerCase();
    base64 = match[2];
  } else if (trimmed.toLowerCase().startsWith("data:")) {
    throw reject("Source image data: URI must be base64-encoded");
  }
  base64 = base64.replace(/\s/g, "");
  if (base64.length > Math.ceil(maxBytes / 3) * 4) throw reject(`Source image must not exceed ${maxBytes} bytes`);
  if (!base64 || base64.length % 4 !== 0 || !BASE64_RE.test(base64)) throw reject("Source image is not valid base64");
  return checkImageBytes(new Uint8Array(Buffer.from(base64, "base64")), declared, maxBytes);
}

/**
 * Fetch a remote source image through the local safe media transport. No
 * credential, cookie or vendor header is sent; failures never quote the URL.
 * @param {object} options - { signal, fetchImpl (raw transport under the guard), timeoutMs, maxBytes, maxRedirects }
 */
export async function fetchRemoteImage(raw, {
  signal, fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = SOURCE_FETCH_TIMEOUT_MS,
  maxBytes = MAX_UPSCALE_SOURCE_BYTES, maxRedirects = SOURCE_FETCH_MAX_REDIRECTS, httpsOnly = false,
} = {}) {
  const url = parsePublicHttpUrl(raw, { httpsOnly });
  if (!url) throw reject(`Source image URL must be ${httpsOnly ? "https" : "http(s)"} on a public host without credentials`);
  const started = Date.now();
  let response;
  try {
    response = await boundedFetch((target, init) => fetchPublic(target, init, {
      maxRedirects,
      fetchImpl: (hop, hopInit) => guardedProbeFetch(hop, hopInit, "public-only", fetchImpl),
    }), url.toString(), { method: "GET", headers: { Accept: "image/*" }, credentials: "omit" }, { signal, timeoutMs });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw Object.assign(reject("Upscale request aborted", 499), { aborted: true });
    if (error?.name === "TimeoutError") throw reject("Source image download timed out", HTTP_STATUS.BAD_REQUEST);
    throw reject("Source image URL was refused or could not be fetched");
  }
  if (response.status !== 200) {
    discard(response);
    throw reject(`Source image URL answered ${response.status}`);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && !type.startsWith("image/") && type !== "application/octet-stream" && type !== "binary/octet-stream") {
    discard(response);
    throw reject("Source image URL did not return an image");
  }
  let bytes;
  try {
    bytes = await readBoundedBytes(response, { signal, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)), maxBytes });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw Object.assign(reject("Upscale request aborted", 499), { aborted: true });
    if (error?.tooLarge) throw reject(`Source image must not exceed ${maxBytes} bytes`);
    throw reject("Source image download failed");
  }
  return checkImageBytes(bytes, null, maxBytes);
}

/** Resolve one source reference to checked bytes (inline decode or guarded fetch). */
export function resolveSourceImage(source, options = {}) {
  if (isRemoteReference(source)) return fetchRemoteImage(source, options);
  return decodeInlineImage(source, options.maxBytes);
}

/** `{ b64_json }` or `{ url: data:… }` with the sniffed MIME. */
export function imageEntry(bytes, format, responseFormat) {
  const base64 = Buffer.from(bytes).toString("base64");
  return responseFormat === "b64_json" ? { b64_json: base64 } : { url: `data:${IMAGE_MIMES[format]};base64,${base64}` };
}
