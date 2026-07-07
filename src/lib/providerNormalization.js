import { AI_PROVIDERS, getProviderByAlias, resolveProviderId } from "../shared/constants/providers.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if (AI_PROVIDERS[trimmed]) return trimmed;
  const resolved = resolveProviderId(trimmed);
  if (AI_PROVIDERS[resolved]) return resolved;

  // Registry alias (e.g. "cmd" -> "command-code", "kc" -> "kilocode")
  const byAlias = getProviderByAlias(trimmed);
  if (byAlias) return byAlias.id;

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (AI_PROVIDERS[slug]) return slug;
  const resolvedSlug = resolveProviderId(slug);
  if (AI_PROVIDERS[resolvedSlug]) return resolvedSlug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return providerByName?.id || trimmed;
}

export function normalizeProviderSpecificData(provider, body = {}, providerSpecificData = null) {
  const next = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  if (provider === "ollama-local") {
    const baseUrl = (
      next.baseUrl ||
      body.baseUrl ||
      body.baseURL ||
      body.ollamaHostUrl ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  if (provider === "google-pse") {
    const cx = [next.cx, body.cx, body.searchEngineId]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .find(Boolean);
    if (cx) next.cx = cx;
    else delete next.cx;
  }

  return Object.keys(next).length > 0 ? next : null;
}
