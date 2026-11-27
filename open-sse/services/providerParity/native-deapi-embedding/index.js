// Staged, unregistered deAPI native embeddings adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createDeapiEmbeddingAdapter } from "./adapter.js";

export * from "./config.js";
export { createDeapiEmbeddingAdapter, normalizeDeapiEmbeddings, packFloat32Base64 } from "./adapter.js";
export { buildDeapiEmbeddingRequest } from "./request.js";
export { deapiAcceptedJob, deapiToken } from "./http.js";

/** Default instance for EMBEDDING_ADAPTERS under `deapi`. */
export const deapiEmbeddingAdapter = createDeapiEmbeddingAdapter();
