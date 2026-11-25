/**
 * Providers whose model list belongs to one connection, not to the provider.
 * Connections may point at different servers or accounts, so a provider-wide snapshot
 * (the first connection's list) would show another account's model IDs to a
 * key scoped elsewhere. Their catalogs are stored and read per connection
 * (see catalog.js `catalogEntryForConnection`). Dependency-free so the DB
 * repository can import it.
 */
export const CONNECTION_SCOPED_SYNC_PROVIDERS = Object.freeze(["mlx", "opencode-server", "grokified", "codex"]);

export function isConnectionScopedSyncProvider(providerId) {
  return CONNECTION_SCOPED_SYNC_PROVIDERS.includes(providerId);
}

/** Store key of one connection's catalog. Never collides with a provider id. */
export function connectionCatalogKey(providerId, connectionId) {
  return `${providerId}#${connectionId}`;
}
