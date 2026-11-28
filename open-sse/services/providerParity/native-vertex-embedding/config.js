/**
 * OmniRoute #20103, MIT, frozen 3a17f7e908308a217887a7617c2c793b95ea83c0:
 * open-sse/handlers/vertexEmbeddings.ts, handlers/embeddings.ts,
 * config/embeddingRegistry.ts, config/vertexModels.ts, executors/vertexAuth.ts.
 * No price or undocumented model limit is inferred. Private, unregistered stage.
 */
export const VERTEX_EMBEDDING_MODELS = Object.freeze([
  { id: "text-embedding-005", dimensions: 768, kind: "embedding" },
  { id: "text-multilingual-embedding-002", dimensions: 768, kind: "embedding" },
  { id: "gemini-embedding-001", dimensions: 3072, kind: "embedding" },
]);
export const VERTEX_EMBEDDING_TIMEOUT_MS = 60000;
export const VERTEX_EMBEDDING_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const VERTEX_EMBEDDING_TASK_TYPE = "RETRIEVAL_QUERY";
