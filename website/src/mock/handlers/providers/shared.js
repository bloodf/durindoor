// Helpers shared by the providers-domain handlers: collection names, the
// connection sanitizer mirroring /api/providers, and connection creation.
import { AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isoAhead, MINUTE_MS } from "../../fixtures/world.js";
import { EXTRA_MODELS } from "../../fixtures/providers/connections.js";

export const CONNECTIONS = "providers.connections";
export const NODES = "providers.nodes";
export const GROUPS = "providers.groups";
export const CUSTOM_MODELS = "providers.customModels";
export const DISABLED_MODELS = "providers.disabledModels";
export const PRICING = "providers.pricing";
export const RESET_CREDITS = "providers.codexResetCredits";

const SECRET_FIELDS = ["apiKey", "accessToken", "refreshToken", "idToken", "firecrawlHeaders"];
const SECRET_PSD_FIELDS = ["clientSecret", "qwenCloudCookie", "alibabaConsoleCookie", "cookie", "QWEN_CLOUD_COOKIE"];
const DEMO_EMAILS = ["balin@erebor.dev", "dwalin@erebor.dev", "ori@erebor.dev", "nori@erebor.dev", "gloin@erebor.dev"];
const AUTO_PING_PROVIDERS = new Set(["claude", "codex"]);

export function isCompatible(provider) {
  return isOpenAICompatibleProvider(provider) || isAnthropicCompatibleProvider(provider) || isCustomEmbeddingProvider(provider);
}

export function sanitizeConnection(connection) {
  const safe = Object.fromEntries(Object.entries(connection).filter(([key]) => !SECRET_FIELDS.includes(key)));
  if (!connection.providerSpecificData) return safe;
  const psd = Object.fromEntries(Object.entries(connection.providerSpecificData).filter(([key]) => !SECRET_PSD_FIELDS.includes(key)));
  return { ...safe, providerSpecificData: psd };
}

/** Client-facing connection list entry (GET /api/providers). */
export function listEntry(connection, nodes) {
  const node = nodes.find((entry) => entry.id === connection.provider);
  const name = isCompatible(connection.provider)
    ? connection.name || node?.name || connection.providerSpecificData?.nodeName || connection.provider
    : connection.name;
  return { ...sanitizeConnection({ ...connection, name }), canDiscoverModels: connection.isActive !== false };
}

export function hasActiveLock(connection) {
  return Object.entries(connection).some(([key, value]) => key.startsWith("modelLock_") && value && new Date(value).getTime() > Date.now());
}

/**
 * Keep the rate-limited Codex account evergreen: while it is still marked
 * unavailable, an expired cooldown rolls forward instead of silently clearing.
 */
export function connections(store) {
  const items = store.list(CONNECTIONS);
  const stale = items.find((item) => item.id === "conn-codex-backup" && item.testStatus === "unavailable" && !hasActiveLock(item));
  if (!stale) return items;
  const until = isoAhead(37 * MINUTE_MS);
  return store.set(CONNECTIONS, items.map((item) => (item === stale ? { ...item, "modelLock_gpt-5.5": until, rateLimitedUntil: until } : item)));
}

export function nextPriority(store, provider) {
  return store.list(CONNECTIONS).filter((item) => item.provider === provider).reduce((max, item) => Math.max(max, item.priority || 0), 0) + 1;
}

/** Create and persist a connection with sensible runtime fields. */
export function createConnection(store, { provider, authType, name, email = null, providerSpecificData = {}, ...rest }) {
  const now = new Date().toISOString();
  const connection = {
    id: store.newId("conn"),
    provider,
    authType,
    name,
    email,
    displayName: name,
    priority: nextPriority(store, provider),
    globalPriority: null,
    defaultModel: null,
    isActive: true,
    testStatus: "active",
    lastError: null,
    lastErrorAt: null,
    errorCode: null,
    lastTested: now,
    lastUsedAt: null,
    consecutiveUseCount: 0,
    providerSpecificData: { connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", ...providerSpecificData },
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
  store.insert(CONNECTIONS, connection);
  return connection;
}

/** Create a connected OAuth account for a provider, or re-activate the one being reconnected. */
export function connectOAuthAccount(store, provider, { connectionId, email, name, providerSpecificData, authType = "oauth" } = {}) {
  if (connectionId && store.find(CONNECTIONS, connectionId)) {
    return store.patch(CONNECTIONS, connectionId, { testStatus: "active", isActive: true, lastError: null, lastErrorAt: null, errorCode: null, updatedAt: new Date().toISOString() });
  }
  const existing = store.list(CONNECTIONS).filter((item) => item.provider === provider);
  const accountEmail = email || DEMO_EMAILS[existing.length % DEMO_EMAILS.length];
  return createConnection(store, {
    provider,
    authType,
    name: name || accountEmail,
    email: accountEmail,
    expiresAt: isoAhead(8 * 60 * MINUTE_MS),
    providerSpecificData: { ...(provider === "codex" ? { chatgptPlanType: "plus", codexFingerprintMode: "session" } : null), ...providerSpecificData },
  });
}

export function providerName(provider) {
  return AI_PROVIDERS[provider]?.name || provider;
}

export function isAutoPingEligible(connection) {
  return AUTO_PING_PROVIDERS.has(connection.provider) && connection.authType === "oauth";
}

/** Plausible `/models` payload for a connection. */
export function modelsFor(connection) {
  const registry = getModelsByProviderId(connection.provider) || [];
  const ids = registry.length ? registry.map((model) => ({ id: model.id, name: model.name || model.id })) : (EXTRA_MODELS[connection.provider] || []).map((id) => ({ id, name: id }));
  return ids.map((model) => ({ ...model, object: "model", owned_by: connection.provider }));
}

/** Deterministic latency so repeated tests look consistent. */
export function latencyFor(id) {
  const hash = [...String(id)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 997, 7);
  return 180 + (hash % 620);
}

/** Outcome of a connection test, mirroring testSingleConnection's result. */
export function testOutcome(connection) {
  if (connection.testStatus === "error" || connection.testStatus === "expired") {
    return { valid: false, error: connection.lastError || "Connection test failed", diagnosis: { type: connection.lastErrorType || "upstream_error", source: "upstream", code: connection.errorCode || null, message: connection.lastError || null }, statusCode: Number(connection.errorCode) || 400 };
  }
  if (connection.testStatus === "unavailable" && hasActiveLock(connection)) {
    return { valid: false, error: connection.lastError || "Rate limited", diagnosis: { type: "rate_limit", source: "upstream", code: "429", message: connection.lastError || null }, statusCode: 429 };
  }
  return { valid: true, error: null, diagnosis: null, statusCode: 200 };
}
