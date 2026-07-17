export function isProviderConfigured(connections, providerId, noAuth = false) {
  if (noAuth) return true;
  return connections.some((c) => c.provider === providerId);
}
