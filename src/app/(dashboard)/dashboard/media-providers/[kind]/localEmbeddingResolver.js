import { resolveProviderId, isLocalOllamaProvider, getProviderAlias } from "@/shared/constants/providers";

/**
 * Derive local Ollama embedding-provider cards from the `/api/v1/models/embedding`
 * response and the current connections list. `buildModelsList` emits each model's
 * `owned_by` as the configured alias or custom prefix; custom prefixes are not
 * registered provider aliases, so `resolveProviderId` would return them unchanged.
 * This helper maps `owned_by` back to the originating connection's provider id,
 * preserving the local-Ollama predicate even when a custom prefix is configured.
 *
 * @param {object[]} models - `/api/v1/models/embedding` data array.
 * @param {object[]} connections - active provider connections from `/api/providers`.
 * @returns {object[]} unique provider descriptor objects for local Ollama entries.
 */
export function getLocalEmbeddingProviders(models, connections) {
  const ownedByToProvider = new Map();
  for (const conn of connections) {
    if (!conn?.provider) continue;
    const providerId = conn.provider;
    ownedByToProvider.set(providerId, providerId);

    const alias = getProviderAlias(providerId);
    if (alias) ownedByToProvider.set(alias, providerId);

    const prefix = conn.providerSpecificData?.prefix;
    if (typeof prefix === "string" && prefix.trim() !== "") {
      ownedByToProvider.set(prefix.trim(), providerId);
    }
  }

  const byProvider = new Map();
  for (const m of models || []) {
    const ownedBy = typeof m.owned_by === "string" ? m.owned_by : "";
    if (!ownedBy) continue;

    let providerId = resolveProviderId(ownedBy);
    if (!isLocalOllamaProvider(providerId)) {
      providerId = ownedByToProvider.get(ownedBy) || providerId;
    }
    if (!isLocalOllamaProvider(providerId)) continue;

    if (!byProvider.has(providerId)) {
      byProvider.set(providerId, {
        id: providerId,
        name: "Ollama Local",
        color: "#ffffffff",
        textIcon: "OL",
      });
    }
  }

  return Array.from(byProvider.values());
}
