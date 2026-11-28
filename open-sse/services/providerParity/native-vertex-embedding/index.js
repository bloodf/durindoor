// Private stage: register-native14 owns imports, catalog, discovery and activation.
export * from "./config.js";
export { buildVertexEmbeddingPlan, mapVertexEmbeddingResponse } from "./request.js";
export { vertexEmbeddingScope, vertexEmbeddingUrl, mintVertexEmbeddingToken } from "./auth.js";
export { createVertexEmbeddingAdapter, vertexEmbeddingAcceptedJob } from "./adapter.js";
import { createVertexEmbeddingAdapter } from "./adapter.js";
export const vertexEmbeddingAdapter = createVertexEmbeddingAdapter();
