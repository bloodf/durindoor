// Mistral native OCR metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/ocrRegistry.ts (the `mistral` OCR_PROVIDERS entry: id
// "mistral", baseUrl https://api.mistral.ai/v1/ocr, authType "apikey",
// authHeader "bearer", models mistral-ocr-latest and mistral-ocr-2512, and
// MISTRAL_PASSTHROUGH: POST JSON `{ ...body, model }` with
// `Authorization: Bearer <token>`, answer returned as is) and
// open-sse/handlers/ocr.ts (handleOcr: the token is `accessToken || apiKey`,
// no poll for this provider).
//
// Vendor contract (wins where it differs from the source): Mistral's public
// OpenAPI document, operation ocr_v1_ocr_post (OCRRequest / OCRResponse), and
// the public models overview. See ./registration.json for pinned digests.
//
// The adapter plugs into the staged OCR foundation
// (../native-ocr-foundation); nothing here is registered.

export const MISTRAL_OCR_PROVIDER_ID = "mistral";
export const MISTRAL_OCR_LABEL = "Mistral";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const MISTRAL_OCR_ORIGIN = "https://api.mistral.ai";
/** Source baseUrl, which the vendor contract documents as POST /v1/ocr. */
export const MISTRAL_OCR_URL = `${MISTRAL_OCR_ORIGIN}/v1/ocr`;

/**
 * Static OCR model rows. The two source ids come first; the models overview
 * lists both as current (mistral-ocr-latest is an alias of OCR 4.1,
 * mistral-ocr-2512 is OCR 3) and adds mistral-ocr-4-1 and mistral-ocr-4 as
 * further OCR 4.1 ids.
 */
export const MISTRAL_OCR_MODELS = Object.freeze([
  { id: "mistral-ocr-latest", name: "Mistral OCR 4.1" },
  { id: "mistral-ocr-2512", name: "Mistral OCR 3" },
  { id: "mistral-ocr-4-1", name: "Mistral OCR 4.1" },
  { id: "mistral-ocr-4", name: "Mistral OCR 4.1" },
].map((row) => Object.freeze({ ...row, kind: "ocr" })));

/**
 * Ids the models overview lists as retired on or before 2026-11-27. They are
 * refused (the source's "mistral-ocr-" prefix fallback would have sent them).
 */
export const MISTRAL_OCR_RETIRED_MODELS = Object.freeze(["mistral-ocr-2503", "mistral-ocr-2505", "mistral-ocr-4-0"]);

/**
 * OCRRequest fields the gateway forwards. Every other vendor field is refused
 * because the normalized answer keeps only `pages[].index` and
 * `pages[].markdown`: table_format and extract_header/extract_footer move
 * content out of markdown, and image, block, confidence and annotation
 * outputs would be billed or sent and then dropped.
 */
export const MISTRAL_OCR_OPTION_FIELDS = Object.freeze(["pages", "image_limit", "image_min_size"]);

/** Bound on the `pages` selector (the vendor caps a document at 1,000 pages). */
export const MISTRAL_OCR_MAX_PAGE_SELECTORS = 1_000;
export const MISTRAL_OCR_MAX_PAGES_STRING_CHARS = 1_024;

export const mistralOcrModel = (id) => MISTRAL_OCR_MODELS.find((row) => row.id === id) ?? null;
