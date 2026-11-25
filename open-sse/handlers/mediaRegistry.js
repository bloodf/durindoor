/** Media registries map provider IDs to entries with an adapter. Adapters retain
 * their kind-specific interfaces; dynamic and config-driven fallbacks remain
 * the responsibility of each kind's lookup. */
export function createMediaRegistry(adapters) {
  return Object.fromEntries(Object.entries(adapters).map(([provider, adapter]) => [provider, { adapter }]));
}

export function lookupMediaAdapter(registry, provider) {
  return registry[provider]?.adapter || null;
}
