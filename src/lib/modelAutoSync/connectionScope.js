/**
 * Providers whose model list belongs to one endpoint, not to the provider.
 * Every connection points at its own server, so a provider-wide snapshot
 * (the first connection's list) would show another account's model IDs to a
 * key scoped elsewhere. Their catalogs are stored and read per connection
 * (see catalog.js `catalogEntryForConnection`). Dependency-free so the DB
 * repository can import it.
 */
export const CONNECTION_SCOPED_SYNC_PROVIDERS = Object.freeze(["mlx", "opencode-server"]);

export function isConnectionScopedSyncProvider(providerId) {
  return CONNECTION_SCOPED_SYNC_PROVIDERS.includes(providerId);
}

/** Store key of one connection's catalog. Never collides with a provider id. */
export function connectionCatalogKey(providerId, connectionId) {
  return `${providerId}#${connectionId}`;
}
