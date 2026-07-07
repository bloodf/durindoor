export function isNoAuthOnlyProvider(providerInfo) {
  return !!providerInfo?.noAuth && !(providerInfo?.authModes || []).includes("apikey");
}
