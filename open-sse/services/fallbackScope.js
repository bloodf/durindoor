import {
  getCanonicalModelId,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";

/**
 * Bound legacy fallback state to a catalog identity. Unknown/passthrough model
 * strings collapse to the single account-wide scope and can never create an
 * attacker-controlled family of durable connection keys. `webFetch` isolates
 * fetch health under `webfetch:<provider>` instead of the chat model scope,
 * and `videoPoll` isolates video job polling under `videopoll:<provider>`.
 *
 * Both flags exist because those requests carry no model: without them the
 * `!model` branch below would collapse to the account-wide scope and let a
 * single failed poll cool down chat and every other modality on the account.
 * They are caller-supplied booleans, not model strings, so they cannot widen
 * the attacker-controlled key space.
 */
export function resolveFallbackModelScope(provider, model, { accountWide = false, webFetch = false, videoPoll = false } = {}) {
  if (webFetch && provider) return `webfetch:${provider}`;
  if (videoPoll && provider) return `videopoll:${provider}`;
  if (accountWide || !provider || !model) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  return getCanonicalModelId(alias, model);
}
