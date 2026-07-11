import {
  getCanonicalModelId,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";

/**
 * Bound legacy fallback state to a catalog identity. Unknown/passthrough model
 * strings collapse to the single account-wide scope and can never create an
 * attacker-controlled family of durable connection keys.
 */
export function resolveFallbackModelScope(provider, model, { accountWide = false } = {}) {
  if (accountWide || !provider || !model) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  return getCanonicalModelId(alias, model);
}
