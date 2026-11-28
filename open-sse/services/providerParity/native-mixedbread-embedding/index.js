// Staged, unregistered Mixedbread native embeddings adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createMixedbreadEmbeddingAdapter } from "./adapter.js";

export * from "./config.js";
export { createMixedbreadEmbeddingAdapter, normalizeMixedbreadEmbeddings, packFloat32Base64 } from "./adapter.js";
export { buildMixedbreadEmbeddingRequest } from "./request.js";
export { mixedbreadAcceptedJob, mixedbreadToken } from "./http.js";

/** Default instance for EMBEDDING_ADAPTERS under `mixedbread`. */
export const mixedbreadEmbeddingAdapter = createMixedbreadEmbeddingAdapter();
