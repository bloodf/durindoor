// Mistral OCR adapter for the staged OCR foundation (#2034). The source's
// MISTRAL_PASSTHROUGH (OmniRoute c71f0065 open-sse/config/ocrRegistry.ts)
// spreads the whole client body into the upstream JSON and returns the answer
// unread. Here only the vendor OCRRequest fields the gateway can honor are
// sent, the document is rebuilt from the foundation's normalized form, and the
// answer is reduced to the foundation's `{ model, pages, usage_info }`. Source
// attribution and the vendor contract are in ./config.js.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { createOcrDispatcher, defineOcrAdapter, ocrReject } from "../native-ocr-foundation/index.js";
import {
  MISTRAL_OCR_LABEL, MISTRAL_OCR_MAX_PAGE_SELECTORS, MISTRAL_OCR_MAX_PAGES_STRING_CHARS, MISTRAL_OCR_MODELS, MISTRAL_OCR_OPTION_FIELDS,
  MISTRAL_OCR_ORIGIN, MISTRAL_OCR_PROVIDER_ID, MISTRAL_OCR_URL,
} from "./config.js";

const PAGES_STRING_RE = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
const pageIndex = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * OCRRequest `pages`: a list of 0-based page indexes, or a comma-separated
 * string of indexes and ascending ranges ("0,1,2", "0-5", "0,2-4").
 */
export function validateMistralOcrPages(value) {
  if (Array.isArray(value)) {
    if (!value.length || value.length > MISTRAL_OCR_MAX_PAGE_SELECTORS || !value.every(pageIndex)) {
      throw ocrReject(`Mistral OCR pages must list 1 to ${MISTRAL_OCR_MAX_PAGE_SELECTORS} page indexes starting from 0`);
    }
    return [...value];
  }
  if (isString(value)) {
    const ranges = value.length <= MISTRAL_OCR_MAX_PAGES_STRING_CHARS && PAGES_STRING_RE.test(value) ? value.split(",") : null;
    const ok = ranges && ranges.length <= MISTRAL_OCR_MAX_PAGE_SELECTORS && ranges.every((part) => {
      const [start, end = start] = part.split("-").map(Number);
      return pageIndex(start) && pageIndex(end) && start <= end;
    });
    if (!ok) throw ocrReject("Mistral OCR pages must be page indexes or ascending ranges such as \"0,2-4\"");
    return value;
  }
  throw ocrReject("Mistral OCR pages must be a list of page indexes or a string such as \"0,2-4\"");
}

/** OCRRequest `image_limit` / `image_min_size`: non-negative integers. */
function nonNegativeInteger(field) {
  return (value) => {
    if (!pageIndex(value)) throw ocrReject(`Mistral OCR ${field} must be a non-negative integer`);
    return value;
  };
}

export const MISTRAL_OCR_OPTIONS = Object.freeze({
  pages: validateMistralOcrPages,
  image_limit: nonNegativeInteger("image_limit"),
  image_min_size: nonNegativeInteger("image_min_size"),
});

/**
 * `Authorization: Bearer <key>` from the selected connection (source
 * authHeader "bearer"). The API key wins over an access token, as in the
 * staged Mistral STT adapter; a blank or whitespace-bearing value is refused.
 */
export function mistralOcrAuthHeaders(credentials) {
  const token = [credentials?.apiKey, credentials?.accessToken].find((value) => isString(value) && value.trim());
  if (!token || /\s/.test(token)) return null;
  return { Authorization: `Bearer ${token}` };
}

/** The OCRRequest document chunk: DocumentURLChunk or ImageURLChunk (string form). */
export function mistralOcrDocument(document) {
  const value = document.source === "url" ? document.url : document.dataUrl;
  return { type: document.type, [document.type]: value };
}

/** Source MISTRAL_PASSTHROUGH buildRequest, narrowed to the declared fields. */
export function buildMistralOcrRequest({ model, document, options }) {
  const body = { model, document: mistralOcrDocument(document) };
  for (const field of MISTRAL_OCR_OPTION_FIELDS) {
    if (options?.[field] !== undefined) body[field] = options[field];
  }
  return { url: MISTRAL_OCR_URL, method: "POST", body };
}

/** OCRResponse to the foundation shape; extra page and top-level fields are dropped by the foundation. */
export function parseMistralOcrResponse(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.pages)) return null;
  const parsed = { pages: raw.pages };
  if (isString(raw.model)) parsed.model = raw.model;
  if (isRecord(raw.usage_info)) parsed.usage_info = raw.usage_info;
  return parsed;
}

export function createMistralOcrAdapter() {
  return defineOcrAdapter({
    id: MISTRAL_OCR_PROVIDER_ID,
    label: MISTRAL_OCR_LABEL,
    origins: [MISTRAL_OCR_ORIGIN],
    models: MISTRAL_OCR_MODELS.map(({ id, name }) => ({ id, name })),
    documentTypes: ["document_url", "image_url"],
    options: MISTRAL_OCR_OPTIONS,
    authHeaders: mistralOcrAuthHeaders,
    buildRequest: buildMistralOcrRequest,
    parseResponse: parseMistralOcrResponse,
  });
}

/** A foundation dispatcher serving only the Mistral adapter (options as createOcrDispatcher). */
export function createMistralOcrDispatcher(options = {}) {
  return createOcrDispatcher({ ...options, adapters: [createMistralOcrAdapter()] });
}
