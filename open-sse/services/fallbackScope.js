import {
  getCanonicalModelId,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";

/**
 * Bound legacy fallback state to a catalog identity. Unknown/passthrough model
 * strings collapse to the single account-wide scope and can never create an
 * attacker-controlled family of durable connection keys. `webFetch` isolates
 * fetch health under `webfetch:<provider>` instead of the chat model scope.
 */
export function resolveFallbackModelScope(provider, model, { accountWide = false, webFetch = false } = {}) {
  if (webFetch && provider) return `webfetch:${provider}`;
  if (accountWide || !provider || !model) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  return getCanonicalModelId(alias, model);
}
