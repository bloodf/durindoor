import { FREE_NO_AUTH_PROVIDER_IDS, isFreeNoAuthProviderById } from "@/shared/constants/freeNoAuthProviders";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { isString } from "../../shared/utils/typeChecks.js";

function disabledSet(settings) {
  return new Set(
    Array.isArray(settings?.disabledFreeProviders) ?
    settings.disabledFreeProviders :
    []
  );
}

/**
 * Check whether a free no-auth provider is currently disabled by settings.
 * Accepts provider id or alias; resolves to canonical id first.
 *
 * @param {string} providerIdOrAlias
 * @param {Object} settings - settings object (already loaded by caller)
 * @returns {boolean}
 */
export function isFreeNoAuthProviderDisabled(providerIdOrAlias, settings) {
  if (!providerIdOrAlias || !isString(providerIdOrAlias)) return false;
  const providerId = resolveProviderId(providerIdOrAlias);
  if (!isFreeNoAuthProviderById(providerId)) return false;
  return disabledSet(settings).has(providerId);
}

/**
 * Filter a list of free no-auth provider IDs down to those currently enabled.
 * @param {string[]} ids
 * @param {Object} settings
 * @returns {string[]}
 */
export function filterEnabledFreeNoAuthProviders(ids, settings) {
  const disabled = disabledSet(settings);
  return ids.filter((id) => !disabled.has(id));
}

export function isFreeNoAuthProviderIdentity(providerId) {
  return isFreeNoAuthProviderById(providerId);
}