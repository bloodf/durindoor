// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/embeddingRegistry.ts and rerankRegistry.ts, deepinfra entries.
// Private staging metadata; no production registry imports this directory.
export const DEEPINFRA_ID = "deepinfra";
export const DEEPINFRA_ALIASES = Object.freeze(["deepinfra"]);
export const DEEPINFRA_ORIGIN = "https://api.deepinfra.com";
export const DEEPINFRA_MODELS_URL = `${DEEPINFRA_ORIGIN}/v1/openai/models`;
export const embeddingModels = Object.freeze([
  {
    "id": "Qwen/Qwen3-Embedding-8B",
    "name": "Qwen3 Embedding 8B",
    "dimensions": 4096
  },
  {
    "id": "Qwen/Qwen3-Embedding-4B",
    "name": "Qwen3 Embedding 4B",
    "dimensions": 2560
  },
  {
    "id": "Qwen/Qwen3-Embedding-0.6B",
    "name": "Qwen3 Embedding 0.6B",
    "dimensions": 1024
  },
  {
    "id": "BAAI/bge-large-en-v1.5",
    "name": "BGE Large EN v1.5",
    "dimensions": 1024
  },
  {
    "id": "BAAI/bge-base-en-v1.5",
    "name": "BGE Base EN v1.5",
    "dimensions": 768
  },
  {
    "id": "BAAI/bge-m3",
    "name": "BGE-M3",
    "dimensions": 1024
  },
  {
    "id": "intfloat/e5-large-v2",
    "name": "E5 Large v2",
    "dimensions": 1024
  },
  {
    "id": "thenlper/gte-large",
    "name": "GTE Large",
    "dimensions": 1024
  }
].map(Object.freeze));
export const rerankModels = Object.freeze([
  {
    "id": "Qwen/Qwen3-Reranker-8B",
    "name": "Qwen3 Reranker 8B"
  },
  {
    "id": "Qwen/Qwen3-Reranker-4B",
    "name": "Qwen3 Reranker 4B"
  },
  {
    "id": "Qwen/Qwen3-Reranker-0.6B",
    "name": "Qwen3 Reranker 0.6B"
  }
].map(Object.freeze));
export const embeddingConfig = Object.freeze({
  id: DEEPINFRA_ID, baseUrl: `${DEEPINFRA_ORIGIN}/v1/openai/embeddings`,
  authType: "apikey", authHeader: "bearer", models: embeddingModels,
});
export const rerankConfig = Object.freeze({
  id: DEEPINFRA_ID, baseUrl: `${DEEPINFRA_ORIGIN}/v1/inference`,
  authType: "apikey", authHeader: "bearer", format: "deepinfra", models: rerankModels,
});
export const deepinfraMediaMetadata = Object.freeze({ embeddingConfig, rerankConfig, serviceKinds: ["embedding", "rerank"] });
