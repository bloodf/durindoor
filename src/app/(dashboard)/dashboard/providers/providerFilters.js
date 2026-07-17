export function isProviderConfigured(connections, providerId, noAuth = false) {
  if (noAuth) return true;
  return connections.some((c) => c.provider === providerId);
}

export const OAUTH_AUTH_TYPES = ["oauth", "access_token"];

export const OAUTH_STATUS_AUTH_TYPES = ["oauth", "access_token", "apikey", "api_key"];

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
