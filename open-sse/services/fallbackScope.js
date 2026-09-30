import {
  getCanonicalModelId,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";

/**
 * Bound legacy fallback state to a catalog identity. Unknown/passthrough model
 * strings collapse to the single account-wide scope and can never create an
 * attacker-controlled family of durable connection keys. `webFetch`, `webSearch`,
 * and `videoPoll` isolate endpoint health under bounded provider keys.
 * Shared account exhaustion from search still blocks all modalities.
 *
 * Endpoint flags normally override catalog lookup because those requests carry no chat
 * model. Without a flag, an unknown model collapses to `__all` and one failed
 * request can cool down every modality on the account.
 * Provider IDs, unlike request model strings, bound the key space.
 */
export function resolveFallbackModelScope(provider, model, { accountWide = false, webFetch = false, webSearch = false, videoPoll = false } = {}) {
  if (accountWide && webSearch) return null;
  if (webFetch && provider) return `webfetch:${provider}`;
  if (webSearch && provider) return `websearch:${provider}`;
  if (videoPoll && provider) return `videopoll:${provider}`;
  if (accountWide || !provider || !model) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  return getCanonicalModelId(alias, model);
}
