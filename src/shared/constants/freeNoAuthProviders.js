/**
 * Free no-auth providers: cloud free providers that need no credentials.
 * NOT local infrastructure (ollama-local, DurinDoor, LM Studio, etc.) or media-only
 * providers (edge-tts, google-tts, local-device, coqui, tortoise, searxng).
 *
 * Defined as: category === "free" && noAuth === true.
 * This is the single source of truth for the free-provider enable toggle.
 */
import REGISTRY from "open-sse/providers/registry/index.js";

export const FREE_NO_AUTH_PROVIDER_IDS = Object.freeze(
  REGISTRY
    .filter((r) => r.category === "free" && r.noAuth === true)
    .map((r) => r.id)
    .sort()
);

export function isFreeNoAuthProvider(providerId) {
  return FREE_NO_AUTH_PROVIDER_IDS.includes(providerId);
}

/**
 * Check whether a registry entry is a free no-auth cloud provider.
 * @param {string} providerId - canonical provider id (use resolveProviderId first if needed)
 * @returns {boolean}
 */
export function isFreeNoAuthProviderById(providerId) {
  return FREE_NO_AUTH_PROVIDER_IDS.includes(providerId);
}

/**
 * @deprecated use isFreeNoAuthProviderById after resolving alias/id.
 */
export function isFreeNoAuthProviderByAlias(aliasOrId) {
  const entry = REGISTRY.find(
    (r) => r.id === aliasOrId || r.alias === aliasOrId || (r.aliases && r.aliases.includes(aliasOrId))
  );
  return entry?.category === "free" && entry?.noAuth === true;
}
