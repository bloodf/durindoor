import { AI_PROVIDERS, getProviderByAlias, resolveProviderId } from "../shared/constants/providers.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */import { isObject, isString } from "@/shared/utils/typeChecks.js";
export function isXaiModel(modelId) {
  return isString(modelId) && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (!isString(provider)) return provider;

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
  const next = providerSpecificData && isObject(providerSpecificData) ?
  { ...providerSpecificData } :
  {};

  if (provider === "codex") {
    delete next.codexClientIdentity;
    delete next.codexOriginalIdentityHeaders;
    if (!["off", "device", "session", "full"].includes(next.codexFingerprintMode)) {
      delete next.codexFingerprintMode;
    }
  }

  if (provider === "ollama-local") {
    const baseUrl = (
    next.baseUrl ||
    body.baseUrl ||
    body.baseURL ||
    body.ollamaHostUrl ||
    "").
    trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  if (provider === "google-pse") {
    const cx = [next.cx, body.cx, body.searchEngineId].
    map((value) => isString(value) ? value.trim() : "").
    find(Boolean);
    if (cx) next.cx = cx;else
    delete next.cx;
  }

  if (AI_PROVIDERS[provider]?.noAuth && AI_PROVIDERS[provider]?.defaultBaseUrl) {
    const baseUrl = String(next.baseUrl || body.baseUrl || body.localBaseUrl || "").trim().replace(/\/+$/, "");
    if (baseUrl) next.baseUrl = baseUrl;
  }

  if (provider === "azure-openai") {
    const baseUrl = String(next.baseUrl || body.baseUrl || body.azureEndpoint || "").trim().replace(/\/+$/, "");
    const apiVersion = String(next.apiVersion || body.apiVersion || "").trim();
    const deployment = String(next.deployment || body.deployment || body.defaultModel || "").trim();

    if (baseUrl) next.baseUrl = baseUrl;
    if (apiVersion) next.apiVersion = apiVersion;
    if (deployment) next.deployment = deployment;
  }

  if (provider === "azure-ai") {
    const baseUrl = String(next.baseUrl || body.baseUrl || body.azureEndpoint || "").trim().replace(/\/+$/, "");
    if (baseUrl) next.baseUrl = baseUrl;
  }

  if (provider === "sap") {
    const baseUrl = String(next.baseUrl || body.baseUrl || body.deploymentUrl || "").trim().replace(/\/+$/, "");
    if (baseUrl) next.baseUrl = baseUrl;
  }
  return Object.keys(next).length > 0 ? next : null;
}