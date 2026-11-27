// Native vertex-deepseek-ocr OCR adapter: identity, endpoint shape and source
// attribution, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/ocrRegistry.ts: OCR_PROVIDERS["vertex-deepseek-ocr"]
//   (no built-in model, Bearer auth, empty base URL),
//   VERTEX_DEEPSEEK_TRANSFORMATION (OpenAI chat-completions body
//   `{ model, messages: [{ role: "user", content: [{ type: "image_url",
//   image_url: <document url> }] }] }`; the answer's
//   choices[0].message.content is either a JSON string with `pages` or plain
//   markdown) and VERTEX_DEEPSEEK_RETIRED_MODEL_ID ("deepseek-ocr-maas",
//   retired by Google on 2026-10-21);
// - open-sse/handlers/ocr.ts: resolveVertexOcrBaseUrl
//   (https://aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi/chat/completions,
//   region us-central1 by default, project from providerSpecificData.project
//   or the Service Account project_id), resolveVertexOcrAccessToken (an
//   existing access token wins, a Service Account JSON mints one, a raw key is
//   an access token already) and handleOcr's retired-model refusal.
//
// The provider-neutral dispatch (validation, deadline, polling, refusals,
// accounting) is the staged native OCR foundation; this unit adds only the
// Vertex DeepSeek-OCR provider half.

export const VERTEX_DEEPSEEK_OCR_PROVIDER_ID = "vertex-deepseek-ocr";
export const VERTEX_DEEPSEEK_OCR_LABEL = "Vertex DeepSeek-OCR";

/** The only origin requests may target (source resolveVertexOcrBaseUrl). */
export const VERTEX_DEEPSEEK_OCR_ORIGIN = "https://aiplatform.googleapis.com";

/** Source VERTEX_OCR_DEFAULT_REGION. */
export const VERTEX_DEEPSEEK_OCR_DEFAULT_REGION = "us-central1";

/** Source VERTEX_DEEPSEEK_RETIRED_MODEL_ID: the managed (MaaS) model Google retired on 2026-10-21. */
export const VERTEX_DEEPSEEK_OCR_RETIRED_MODEL_ID = "deepseek-ocr-maas";

/**
 * Inline documents travel as an image_url content part, so only image data
 * URLs are accepted inline. Remote document URLs are forwarded as given.
 */
export const VERTEX_DEEPSEEK_OCR_INLINE_MEDIA_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif", "image/tiff"]);

/** Bound on minting an access token from a Service Account or ADC file; nothing billable is sent meanwhile. */
export const VERTEX_DEEPSEEK_OCR_TOKEN_TIMEOUT_MS = 15_000;

/** The chat-completions path under the Vertex origin for a project and region. */
export const vertexDeepseekOcrPath = (project, region) =>
  `/v1/projects/${project}/locations/${region}/endpoints/openapi/chat/completions`;
