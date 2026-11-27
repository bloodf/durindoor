// Native OCR dispatch foundation: shared bounds and source attribution,
// staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/ocrRegistry.ts (OcrProvider / OcrTransformation: per-provider
// buildRequest, parseResponse and optional pollUrl; parseOcrModel's
// "provider/model" prefix and bare-id lookup; the Mistral OCR response shape
// { pages: [{ index, markdown }], model, usage_info }) and
// open-sse/handlers/ocr.ts (handleOcr: `document` required, provider chosen
// from the model, transformation dispatch, same-origin poll of the returned
// operation URL with redirects refused, 30 attempts one second apart, upstream
// error text sanitized, accounting best-effort).
//
// Only the provider-neutral half is staged here. No provider entry, model,
// base URL or auth scheme from the source registry is carried: each provider
// adapter supplies its own (see ./adapter.js), and nothing is registered.

export const OCR_MODALITY = "ocr";

/** Document kinds the source reads (`document.document_url ?? document.image_url`). */
export const OCR_DOCUMENT_TYPES = Object.freeze(["document_url", "image_url"]);

/** Inline (data URL) media types the foundation accepts; adapters may narrow this list. */
export const OCR_INLINE_MEDIA_TYPES = Object.freeze([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/tiff",
]);

// Gateway bounds. The source sets none besides the poll schedule.
/** One deadline for the submit and every poll of a request. */
export const OCR_TIMEOUT_MS = 300_000;
/** Source pollOcrOperation: OCR_POLL_MAX_ATTEMPTS. */
export const OCR_POLL_MAX_ATTEMPTS = 30;
/** Source pollOcrOperation: OCR_POLL_INTERVAL_MS. */
export const OCR_POLL_INTERVAL_MS = 1_000;
export const OCR_MAX_DOCUMENT_URL_CHARS = 8_192;
/** Decoded size cap for an inline document. */
export const OCR_MAX_INLINE_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const OCR_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const OCR_MAX_ERROR_BYTES = 16 * 1024;
export const OCR_MAX_PAGES = 5_000;
export const OCR_MAX_MODEL_CHARS = 256;
