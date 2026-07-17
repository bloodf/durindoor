export function isNoAuthOnlyProvider(providerInfo) {
  return !!providerInfo?.noAuth && !(providerInfo?.authModes || []).includes("apikey");
}

/**
 * No-auth-only providers use proxy settings instead of saved credentials.
 * Dual-auth providers (for example Pollinations) must keep the connections UI
 * reachable so users can add the optional key that unlocks premium models.
 */
export function shouldShowProviderConnections(providerInfo, { storedNoAuth = false } = {}) {
  return storedNoAuth || !isNoAuthOnlyProvider(providerInfo);
}
