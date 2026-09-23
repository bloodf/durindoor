import { AI_PROVIDERS, getProviderByAlias, resolveProviderId } from "../shared/constants/providers.js";
import { normalizePeakHourProtection } from "./providers/peakHourProtection.js";
import { MAX_CONNECTION_TIMEOUT_MS } from "./providers/requestTimeout.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
import { isObject, isString } from "../shared/utils/typeChecks.js";

const RATE_LIMIT_OVERRIDE_KEYS = ["rpd", "minTime"];

/**
 * Sanitize `providerSpecificData.rateLimitOverrides`, keeping only known
 * positive-integer overrides. An absent or empty object clears the key so a
 * stale override cannot silently survive a save that removed it.
 * @param {unknown} value
 * @returns {Record<string, number>|null}
 */
function normalizeRateLimitOverrides(value) {
  if (!value || !isObject(value)) return null;
  const next = {};
  for (const key of RATE_LIMIT_OVERRIDE_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) next[key] = Math.floor(parsed);
  }
  return Object.keys(next).length > 0 ? next : null;
}
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

  if (AI_PROVIDERS[provider]?.credentialForm === "aws") {
    // The STS session token is a secret kept in the encrypted top-level connection field, never
    // in plaintext providerSpecificData. Updates deep-merge into the stored object, where an
    // omitted key survives, so a copy is overwritten with null rather than deleted.
    if (Object.hasOwn(next, "sessionToken")) next.sessionToken = null;
    // A cleared profile stays as "" for the same reason: dropping it would let the merge restore
    // the old profile, which keeps winning over any new key.
    if (Object.hasOwn(next, "profile")) next.profile = isString(next.profile) ? next.profile.trim() : "";
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

  // Generic, provider-agnostic overrides (port(omniroute): peak-hour protection,
  // per-connection RPD and upstream timeout — OmniRoute #11622, #12147, #10885).
  if (Object.hasOwn(next, "peakHourProtection")) {
    const peakHourProtection = normalizePeakHourProtection(next.peakHourProtection);
    if (peakHourProtection) next.peakHourProtection = peakHourProtection;else
    delete next.peakHourProtection;
  }

  if (Object.hasOwn(next, "rateLimitOverrides")) {
    const rateLimitOverrides = normalizeRateLimitOverrides(next.rateLimitOverrides);
    if (rateLimitOverrides) next.rateLimitOverrides = rateLimitOverrides;else
    delete next.rateLimitOverrides;
  }

  if (Object.hasOwn(next, "timeoutMs")) {
    const timeoutMs = Number(next.timeoutMs);
    if (Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_CONNECTION_TIMEOUT_MS) {
      next.timeoutMs = timeoutMs;
    } else {
      delete next.timeoutMs;
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}