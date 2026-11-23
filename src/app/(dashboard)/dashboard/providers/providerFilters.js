import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_TIER_PROVIDERS } from "@/shared/constants/providers";

/**
 * Match a provider card against the header search by provider name or by any
 * registry model (id, display name, or "providerId/modelId"), so users can type
 * a model such as "gpt-5" and find every provider that serves it. Incomplete
 * registry metadata (missing name or model fields) never throws.
 *
 * @param {string|undefined} name
 * @param {string} searchQuery
 * @param {string} [providerId]
 * @param {Array<{id?: string, name?: string}>} [models]
 */
export function matchesProviderSearch(name, searchQuery, providerId = "", models = []) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;
  if (name && name.toLowerCase().includes(query)) return true;
  if (!providerId || !Array.isArray(models)) return false;
  return models.some((model) => {
    const id = String(model?.id ?? "").toLowerCase();
    const modelName = String(model?.name ?? "").toLowerCase();
    return (id && id.includes(query)) ||
      modelName.includes(query) ||
      (id && `${providerId.toLowerCase()}/${id}`.includes(query));
  });
}

export function isProviderConfigured(connections, providerId, noAuth = false) {
  if (noAuth) return true;
  return connections.some((c) => c.provider === providerId);
}

export const OAUTH_AUTH_TYPES = ["oauth", "access_token"];

export const OAUTH_STATUS_AUTH_TYPES = ["oauth", "access_token", "apikey", "api_key", "auth_token"];

/**
 * Returns auth scopes used to render a free-provider card. Registry rows that
 * predate authModes still expose their API-key connection path.
 *
 * @param {string} providerId
 * @param {{authModes?: string[], authType?: string}} provider
 * @returns {string[]}
 */
export function getFreeAuthTypes(providerId, provider) {
  if (providerId === "kiro") return ["oauth", "apikey", "api_key"];
  if (Array.isArray(provider.authModes) && provider.authModes.length > 0) {
    return provider.authModes;
  }
  if (provider.authType) return [provider.authType];
  if (providerId in FREE_TIER_PROVIDERS || providerId in APIKEY_PROVIDERS) {
    return ["oauth", "apikey", "api_key"];
  }
  return OAUTH_AUTH_TYPES;
}

/** Match one derived provider status; "all" deliberately preserves every status category. */
export function matchesProviderStatus(statusFilter, providerStatus) {
  return statusFilter === "all" || providerStatus === statusFilter;
}

/**
 * Derive the dashboard status of a provider based on its connection rows and
 * free-provider opt-out setting.
 *
 * @param {Array<{provider:string, authType:string, isActive?:boolean}>} connections
 * @param {string} providerId
 * @param {string|string[]} authTypes - auth scope(s) for the category (e.g. "oauth" or ["oauth","apikey","api_key"]).
 * @param {boolean} noAuth - whether the provider is a static no-auth free provider.
 * @param {string[]} disabledFreeProviders - list of opt-out free provider IDs.
 * @returns {"active" | "deactivated" | "not-configured"}
 */
export function getProviderStatus(
  connections,
  providerId,
  authTypes,
  noAuth = false,
  disabledFreeProviders = [],
) {
  const types = Array.isArray(authTypes) ? authTypes : [authTypes];
  const rows = connections.filter(
    (c) => c.provider === providerId && types.includes(c.authType),
  );

  if (rows.length > 0) {
    return rows.every((c) => c.isActive === false) ? "deactivated" : "active";
  }

  if (noAuth) {
    return disabledFreeProviders.includes(providerId) ? "deactivated" : "active";
  }

  return "not-configured";
}
