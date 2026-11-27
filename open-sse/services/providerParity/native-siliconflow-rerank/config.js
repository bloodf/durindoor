// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/rerankRegistry.ts `siliconflow` entry and
// src/app/api/providers/[id]/models/discovery/providerSets.ts (`siliconflow` in
// NAMED_OPENAI_STYLE_PROVIDERS: live `<baseUrl>/models` discovery).
// Private staging metadata; no production registry imports this directory.
export const SILICONFLOW_ID = "siliconflow";
export const SILICONFLOW_ALIASES = Object.freeze(["siliconflow"]);
export const SILICONFLOW_ORIGIN = "https://api.siliconflow.com";
export const SILICONFLOW_RERANK_URL = `${SILICONFLOW_ORIGIN}/v1/rerank`;
export const SILICONFLOW_MODELS_URL = `${SILICONFLOW_ORIGIN}/v1/models`;
export const rerankModels = Object.freeze([
  Object.freeze({ id: "Qwen/Qwen3-Reranker-8B", name: "Qwen3 Reranker 8B" }),
  Object.freeze({ id: "Qwen/Qwen3-Reranker-4B", name: "Qwen3 Reranker 4B" }),
  Object.freeze({ id: "Qwen/Qwen3-Reranker-0.6B", name: "Qwen3 Reranker 0.6B" }),
  Object.freeze({ id: "BAAI/bge-reranker-v2-m3", name: "BGE Reranker v2 m3" }),
]);
/** Exact pinned registry fields; the source uses the default Cohere-compatible envelope (no `format`). */
export const rerankConfig = Object.freeze({
  id: SILICONFLOW_ID, baseUrl: SILICONFLOW_RERANK_URL,
  authType: "apikey", authHeader: "bearer", models: rerankModels,
});
/** Additive metadata for the existing provider definition; never replaces transport/auth. */
export const siliconflowRerankMetadata = Object.freeze({
  rerankConfig,
  serviceKinds: Object.freeze(["rerank"]),
  models: Object.freeze(rerankModels.map((m) => Object.freeze({ ...m, kind: "rerank" }))),
});
