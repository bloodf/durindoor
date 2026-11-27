// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/rerankRegistry.ts `together` entry and
// src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts `together`.
// Private staging metadata; no production registry imports this directory.
export const TOGETHER_ID = "together";
export const TOGETHER_ALIASES = Object.freeze(["together"]);
export const TOGETHER_ORIGIN = "https://api.together.xyz";
export const TOGETHER_RERANK_URL = `${TOGETHER_ORIGIN}/v1/rerank`;
export const TOGETHER_MODELS_URL = `${TOGETHER_ORIGIN}/v1/models`;
export const rerankModels = Object.freeze([
  Object.freeze({ id: "Salesforce/Llama-Rank-V2", name: "Llama Rank V2" }),
]);
/** Exact pinned registry fields; the source uses the default Cohere-compatible envelope (no `format`). */
export const rerankConfig = Object.freeze({
  id: TOGETHER_ID, baseUrl: TOGETHER_RERANK_URL,
  authType: "apikey", authHeader: "bearer", models: rerankModels,
});
/** Additive metadata for the existing provider definition; never replaces transport/auth. */
export const togetherRerankMetadata = Object.freeze({
  rerankConfig,
  serviceKinds: Object.freeze(["rerank"]),
  models: Object.freeze(rerankModels.map((m) => Object.freeze({ ...m, kind: "rerank" }))),
});
