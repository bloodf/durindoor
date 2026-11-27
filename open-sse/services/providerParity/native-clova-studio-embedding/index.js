// Staged, unregistered Naver CLOVA Studio native embeddings adapter (#2034).
// Nothing in production imports this module yet; ./registration.json describes
// the serial registration step. Source attribution is in ./config.js.
import { createClovaEmbeddingAdapter } from "./adapter.js";

export * from "./config.js";
export { createClovaEmbeddingAdapter, normalizeClovaEmbedding, packFloat32Base64 } from "./adapter.js";
export { buildClovaEmbeddingRequest } from "./request.js";
export { clovaAcceptedJob, clovaToken } from "./http.js";

/** Default instance for EMBEDDING_ADAPTERS under `clova-studio`. */
export const clovaEmbeddingAdapter = createClovaEmbeddingAdapter();
