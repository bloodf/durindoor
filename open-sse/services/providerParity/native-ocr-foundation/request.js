// Request validation for the staged OCR foundation (#2034). The source
// (handleOcr in OmniRoute c71f0065 open-sse/handlers/ocr.ts) checks only that
// `document` is present, defaults the model to "mistral-ocr-latest", forwards
// the whole client body to the provider and lets the provider fetch any URL.
// Here, before anything is sent: the model must resolve to the selected
// adapter, the document must be one https URL on a public host or one bounded
// base64 data URL of an accepted type, and every other top-level field must be
// one the adapter declares.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { OCR_MAX_DOCUMENT_URL_CHARS, OCR_MAX_INLINE_DOCUMENT_BYTES, OCR_MAX_MODEL_CHARS } from "./config.js";

/** A refusal of the caller's input, turned into a local 400 by the dispatcher. */
export const ocrReject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST, ocrInput: true });

const present = (value) => value !== undefined && value !== null;
// Whitespace, control characters, path traversal and URL syntax are never part of a model id.
const UNSAFE_MODEL_RE = /[\s\u0000-\u001f\u007f?#\\]|\.\.|^\/|\/$|\/\//;
const DATA_URL_RE = /^data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*);base64,([A-Za-z0-9+/]*={0,2})$/i;

/**
 * The model id to send, for the selected adapter only (source parseOcrModel,
 * scoped): "<provider>/<id>" or a bare id, accepted when it is one of the
 * adapter's models or its acceptsModel says so. There is no default model.
 */
export function resolveOcrModel(adapter, value) {
  if (!present(value)) throw ocrReject(`OCR requests need a model for ${adapter.label}`);
  if (!isString(value) || !value || value.length > OCR_MAX_MODEL_CHARS || UNSAFE_MODEL_RE.test(value)) {
    throw ocrReject("OCR model must be a plain model id");
  }
  const id = value.startsWith(`${adapter.id}/`) ? value.slice(adapter.id.length + 1) : value;
  if (!id || UNSAFE_MODEL_RE.test(id)) throw ocrReject("OCR model must be a plain model id");
  if (adapter.models.some((row) => row.id === id) || adapter.acceptsModel?.(id) === true) return id;
  const listed = adapter.models.map((row) => row.id).join(", ");
  throw ocrReject(`Unsupported OCR model for ${adapter.label}: ${value}${listed ? `. Use one of: ${listed}` : ""}`);
}

function publicHttpsUrl(adapter, value) {
  if (!adapter.acceptsUrl) throw ocrReject(`${adapter.label} OCR takes inline documents only`);
  let url = null;
  try {
    url = value.length <= OCR_MAX_DOCUMENT_URL_CHARS ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || !url.hostname || isBlockedHost(url.hostname)) {
    throw ocrReject(`OCR document URL must be a public https URL of at most ${OCR_MAX_DOCUMENT_URL_CHARS} characters`);
  }
  url.hash = "";
  return { source: "url", url: url.href };
}

function inlineDocument(adapter, type, value) {
  if (!adapter.inlineMediaTypes.length) throw ocrReject(`${adapter.label} OCR takes document URLs only`);
  // 4 base64 characters per 3 bytes, plus a bounded header: refuse before matching.
  if (value.length > Math.ceil(OCR_MAX_INLINE_DOCUMENT_BYTES / 3) * 4 + 256) throw ocrReject(`OCR inline documents must not exceed ${OCR_MAX_INLINE_DOCUMENT_BYTES} bytes`);
  const match = DATA_URL_RE.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw ocrReject("OCR inline documents must be base64 data URLs");
  const mediaType = match[1].toLowerCase();
  if (!adapter.inlineMediaTypes.includes(mediaType)) {
    throw ocrReject(`${adapter.label} OCR does not accept ${mediaType}; use one of: ${adapter.inlineMediaTypes.join(", ")}`);
  }
  if (type === "image_url" && !mediaType.startsWith("image/")) throw ocrReject("OCR image_url documents must be images");
  const base64 = match[2];
  const bytes = (base64.length / 4) * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes < 1) throw ocrReject("OCR inline documents must not be empty");
  if (bytes > OCR_MAX_INLINE_DOCUMENT_BYTES) throw ocrReject(`OCR inline documents must not exceed ${OCR_MAX_INLINE_DOCUMENT_BYTES} bytes`);
  return { source: "inline", mediaType, bytes, base64, dataUrl: `data:${mediaType};base64,${base64}` };
}

/**
 * The normalized document: `{ type, source: "url", url }` or
 * `{ type, source: "inline", mediaType, bytes, base64, dataUrl }`.
 * Accepts the source's `{ type?, document_url }` / `{ type?, image_url }`;
 * `image_url` may also be `{ url }`.
 */
export function normalizeOcrDocument(adapter, document) {
  if (!present(document)) throw ocrReject("document is required");
  if (!isRecord(document)) throw ocrReject("OCR document must be an object");
  const fields = ["document_url", "image_url"].filter((name) => present(document[name]));
  if (fields.length !== 1) throw ocrReject("OCR document needs exactly one of document_url or image_url");
  const [type] = fields;
  if (present(document.type) && document.type !== type) throw ocrReject(`OCR document type ${String(document.type)} does not match its ${type} field`);
  const unknown = Object.keys(document).find((key) => key !== "type" && key !== type && present(document[key]));
  if (unknown) throw ocrReject(`OCR document field ${unknown} is not supported`);
  if (!adapter.documentTypes.includes(type)) throw ocrReject(`${adapter.label} OCR does not accept ${type} documents`);
  let value = document[type];
  if (type === "image_url" && isRecord(value)) {
    const extra = Object.keys(value).find((key) => key !== "url" && present(value[key]));
    if (extra) throw ocrReject(`OCR image_url field ${extra} is not supported`);
    value = value.url;
  }
  if (!isString(value) || !value) throw ocrReject(`OCR ${type} must be a URL string`);
  const normalized = /^data:/i.test(value) ? inlineDocument(adapter, type, value) : publicHttpsUrl(adapter, value);
  return Object.freeze({ type, ...normalized });
}

/**
 * Validate a client body for the selected adapter.
 *
 * @returns {{ model: string, document: object, options: object }}
 * @throws an `ocrReject` error for any refused input
 */
export function validateOcrRequest(adapter, body) {
  if (!isRecord(body)) throw ocrReject("OCR requests need a JSON object");
  const unknown = Object.keys(body).find((key) => key !== "model" && key !== "document" && !Object.hasOwn(adapter.options, key) && present(body[key]));
  if (unknown) throw ocrReject(`${adapter.label} OCR does not support ${unknown}`);
  const model = resolveOcrModel(adapter, body.model);
  const document = normalizeOcrDocument(adapter, body.document);
  const options = {};
  for (const [field, check] of Object.entries(adapter.options)) {
    if (!present(body[field])) continue;
    let value;
    try {
      value = check(body[field]);
    } catch (error) {
      throw ocrReject(error?.ocrInput ? error.message : `${adapter.label} OCR ${field} is not valid`);
    }
    if (value !== undefined) options[field] = value;
  }
  return { model, document, options: Object.freeze(options) };
}
