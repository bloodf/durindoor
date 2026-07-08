// Barrel: PROVIDERS now built from providers/registry (transport co-located with models)
import { PROVIDERS } from "../providers/index.js";
export { PROVIDERS, PROVIDER_OAUTH } from "../providers/index.js";

export const OLLAMA_LOCAL_DEFAULT_HOST = "http://localhost:11434";

export function resolveOllamaLocalHost(credentials) {
  const raw = credentials?.providerSpecificData?.baseUrl?.trim();
  return (raw || OLLAMA_LOCAL_DEFAULT_HOST).replace(/\/api\/chat\/?$/, "").replace(/\/$/, "");
}

// Region URLs single-source from registry xiaomi-tokenplan.transport
export const XIAOMI_TOKENPLAN_REGIONS = PROVIDERS["xiaomi-tokenplan"]?.regions || {};
export const XIAOMI_TOKENPLAN_DEFAULT_REGION = PROVIDERS["xiaomi-tokenplan"]?.defaultRegion;

export function resolveXiaomiTokenplanBaseUrl(credentials) {
  const region = credentials?.providerSpecificData?.region;
  return XIAOMI_TOKENPLAN_REGIONS[region] || XIAOMI_TOKENPLAN_REGIONS[XIAOMI_TOKENPLAN_DEFAULT_REGION];
}

export const HEROKU_DEFAULT_BASE_URL = PROVIDERS.heroku?.baseUrl?.replace(/\/chat\/completions$/, "") || "https://us.inference.heroku.com/v1";

// Heroku provisions both INFERENCE_KEY and INFERENCE_URL per app; users on a
// region/model other than the default us.inference.heroku.com endpoint supply
// their own INFERENCE_URL via providerSpecificData.baseUrl. Accept either the
// bare API root or a full endpoint URL (strip /chat/completions, /models).
export function resolveHerokuBaseUrl(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const raw = (psd.inferenceUrl || psd.baseUrl)?.trim();
  if (!raw) return HEROKU_DEFAULT_BASE_URL;
  return raw.replace(/\/$/, "").replace(/\/(chat\/completions|models)$/, "");
}
