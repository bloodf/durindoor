// Staged, unregistered NanoGPT native embeddings adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createNanogptEmbeddingAdapter } from "./adapter.js";

export * from "./config.js";
export { createNanogptEmbeddingAdapter, normalizeNanogptEmbeddings, packFloat32Base64 } from "./adapter.js";
export { buildNanogptEmbeddingRequest } from "./request.js";
export { nanogptAcceptedJob, nanogptToken } from "./http.js";

/** Default instance for EMBEDDING_ADAPTERS under `nanogpt`. */
export const nanogptEmbeddingAdapter = createNanogptEmbeddingAdapter();
