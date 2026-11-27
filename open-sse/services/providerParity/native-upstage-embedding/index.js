// Staged, unregistered Upstage native embeddings adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createUpstageEmbeddingAdapter } from "./adapter.js";

export * from "./config.js";
export { createUpstageEmbeddingAdapter, normalizeUpstageEmbeddings, packFloat32Base64 } from "./adapter.js";
export { buildUpstageEmbeddingRequest } from "./request.js";
export { upstageAcceptedJob, upstageToken } from "./http.js";

/** Default instance for EMBEDDING_ADAPTERS under `upstage`. */
export const upstageEmbeddingAdapter = createUpstageEmbeddingAdapter();
