// Barrel: PROVIDERS now built from providers/registry (transport co-located with models)
import { PROVIDERS } from "../providers/index.js";
import REGISTRY from "../providers/registry/index.js";
export { PROVIDERS, PROVIDER_OAUTH } from "../providers/index.js";

/**
 * Chat-auto-combo eligibility for a no-auth registry entry. Canonical
 * predicate — an explicit opt-in capability, `autoComboNoAuth === true`, marks
 * the curated chat no-auth providers upstream seeds into its auto-combo pool
 * (mirrors upstream `NOAUTH_PROVIDERS` membership without duplicating the ID
 * list here). Entries also require `noAuth===true`, `category==="free"` and
 * — when `serviceKinds` is a non-empty array — must include "llm".
 * @param {Object} entry registry entry
 * @returns {boolean}
 */
export function isChatAutoComboNoAuthProvider(entry) {
  if (entry?.autoComboNoAuth !== true) return false;
  if (entry?.noAuth !== true) return false;
  if (entry.category !== "free") return false;
  if (!Array.isArray(entry.serviceKinds) || entry.serviceKinds.length === 0) return true;
  return entry.serviceKinds.includes("llm");
}

// No-auth provider config (OmniRoute #6889 / #6557): the canonical map of the
// chat no-auth providers seeded into the auto-combo pool by DEFAULT, keyed by
// connection `provider` id. Registry-derived via the `autoComboNoAuth` opt-in
// marker (never a hardcoded provider list). A provider's own connection row's
// `isActive=false` suppresses it via `applyNoAuthAutoComboGate`.
export const NOAUTH_PROVIDERS = Object.fromEntries(
  REGISTRY.filter(isChatAutoComboNoAuthProvider).map((entry) => [entry.id, entry])
);

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
