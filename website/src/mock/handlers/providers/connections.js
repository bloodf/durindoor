// /api/providers: connection CRUD, tests, model discovery, reorder, validation
// and the paginated quota-eligible client list.
import { reply, notFound, badRequest } from "../../http.js";
import {
  AI_PROVIDERS, FREE_PROVIDERS, OAUTH_PROVIDERS, USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS, WEB_COOKIE_PROVIDERS,
  isOpenAICompatibleProvider, isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { KILO_FREE_MODELS } from "../../fixtures/providers/catalog.js";
import {
  CONNECTIONS, NODES, connections, createConnection, isAutoPingEligible, isCompatible, latencyFor, listEntry,
  modelsFor, providerName, sanitizeConnection, testOutcome,
} from "./shared.js";

const API_KEY_AUTH_TYPES = ["apikey", "api_key"];
const MAX_PRIORITY = 100_000;

function authGroup(connection) {
  if (connection.authType === "oauth") return FREE_PROVIDERS[connection.provider] ? "free" : "oauth";
  return connection.authType || (OAUTH_PROVIDERS[connection.provider] ? "oauth" : "apikey");
}

function selectForBatch(all, mode, providerId) {
  switch (mode) {
    case "provider": return providerId ? all.filter((c) => c.provider === providerId) : null;
    case "oauth":
    case "free":
    case "apikey": return all.filter((c) => authGroup(c) === mode);
    case "compatible": return all.filter((c) => isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider));
    case "all": return all;
    default: return null;
  }
}

function applyTestResult(store, connection, outcome) {
  const now = new Date().toISOString();
  const changes = outcome.valid
    ? { testStatus: "active", lastTested: now, lastError: null, lastErrorAt: null, errorCode: null }
    : { lastTested: now, lastErrorAt: connection.lastErrorAt || now };
  return store.patch(CONNECTIONS, connection.id, changes);
}

function isUsageEligible(connection) {
  if (connection.isActive === false && connection.authType !== "oauth") return false;
  return USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) && (
    connection.authType === "oauth" || (API_KEY_AUTH_TYPES.includes(connection.authType) && USAGE_APIKEY_PROVIDERS.includes(connection.provider))
  );
}

// Mirrors sanitizeProviderConnectionForClient: stale "unavailable" reads as active.
function clientEntry(connection) {
  const safe = sanitizeConnection(connection);
  const locked = Object.entries(connection).some(([key, value]) => key.startsWith("modelLock_") && value && new Date(value).getTime() > Date.now());
  return safe.testStatus === "unavailable" && !locked ? { ...safe, testStatus: "active" } : safe;
}

function validPriority(value) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 1 && num <= MAX_PRIORITY ? num : null;
}

function buildUpdate(existing, body) {
  const fields = ["name", "defaultModel", "isActive", "testStatus", "lastError", "lastErrorAt"];
  const picked = Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
  const proxyFields = ["connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy"].filter((field) => Object.hasOwn(body, field));
  const psdPatch = {
    ...(body.providerSpecificData || {}),
    ...Object.fromEntries(proxyFields.map((field) => [field, body[field]])),
    ...(body.proxyPoolId !== undefined ? { proxyPoolId: body.proxyPoolId === "__none__" || body.proxyPoolId === "" ? null : body.proxyPoolId } : null),
  };
  const psd = Object.keys(psdPatch).length ? { providerSpecificData: { ...(existing.providerSpecificData || {}), ...psdPatch } } : null;
  // An explicit successful check clears stale failures and model cooldowns.
  const reset = picked.testStatus === "active"
    ? { lastError: null, lastErrorAt: null, errorCode: null, rateLimitedUntil: null, backoffLevel: 0, ...Object.fromEntries(Object.keys(existing).filter((key) => key.startsWith("modelLock_")).map((key) => [key, null])) }
    : null;
  return { ...picked, ...reset, ...psd, updatedAt: new Date().toISOString() };
}

function createApiKeyConnection(store, body) {
  const provider = String(body.provider || "").trim();
  const nodes = store.list(NODES);
  const node = nodes.find((entry) => entry.id === provider);
  const known = AI_PROVIDERS[provider] || isCompatible(provider);
  if (!provider || !known) return badRequest("Invalid provider");
  if (isCompatible(provider) && !node) return notFound("Compatible node not found");
  const noAuth = AI_PROVIDERS[provider]?.noAuth === true || provider === "ollama-local";
  const isCookie = Boolean(WEB_COOKIE_PROVIDERS[provider]);
  if (!body.apiKey && !noAuth) return badRequest(`${isCookie ? "Cookie value" : "API Key"} is required`);
  const name = String(body.name || body.displayName || providerName(provider)).trim();
  if (!name) return badRequest("Name is required");
  const duplicate = store.list(CONNECTIONS).some((c) => c.provider === provider && c.authType !== "oauth" && c.name === name);
  if (duplicate) {
    const code = body.createOnly === true ? "PROVIDER_CONNECTION_NAME_CONFLICT" : "PROVIDER_CONNECTION_ALREADY_EXISTS";
    return reply({ error: `A connection named "${name}" already exists for this provider`, code }, { status: 409 });
  }
  const nodeData = node ? { prefix: node.prefix, baseUrl: node.baseUrl, nodeName: node.name, ...(node.apiType ? { apiType: node.apiType } : null) } : {};
  const connection = createConnection(store, {
    provider,
    authType: isCookie ? "cookie" : "apikey",
    name,
    ...(body.priority ? { priority: validPriority(body.priority) || 1 } : null),
    globalPriority: body.globalPriority || null,
    defaultModel: body.defaultModel || null,
    testStatus: body.testStatus || "active",
    providerSpecificData: {
      ...(body.providerSpecificData || {}),
      ...nodeData,
      connectionProxyEnabled: body.connectionProxyEnabled === true,
      connectionProxyUrl: body.connectionProxyUrl || "",
      connectionNoProxy: body.connectionNoProxy || "",
      ...(body.proxyPoolId && body.proxyPoolId !== "__none__" ? { proxyPoolId: body.proxyPoolId } : null),
    },
  });
  return reply({ connection: sanitizeConnection(connection) }, { status: 201 });
}

export default function registerConnections(router, { store }) {
  router.get("/api/providers", () => {
    const nodes = store.list(NODES);
    return { connections: connections(store).map((connection) => listEntry(connection, nodes)) };
  });

  router.post("/api/providers", ({ body = {} }) => createApiKeyConnection(store, body));

  router.get("/api/providers/client", ({ query }) => {
    const provider = query.provider || "all";
    const accountStatus = query.accountStatus || "all";
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 20, 1), 500);
    const eligible = connections(store).filter(isUsageEligible);
    const byProvider = eligible.filter((c) => provider === "all" || c.provider === provider);
    const byStatus = byProvider.filter((c) => (accountStatus === "active" ? c.isActive !== false : accountStatus === "inactive" ? c.isActive === false : true));
    const sorted = [...byStatus].sort((a, b) => (query.sort === "provider"
      ? USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider) - USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider)
      : (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) || a.provider.localeCompare(b.provider)));
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(Number.parseInt(query.page, 10) || 1, 1), totalPages);
    return {
      connections: sorted.slice((page - 1) * pageSize, page * pageSize).map(clientEntry),
      providerOptions: [...new Set(eligible.map((c) => c.provider))].sort(),
      pagination: { page, pageSize, total: sorted.length, totalPages },
      totals: { eligibleConnections: eligible.length, providerFilteredConnections: byProvider.length },
    };
  });

  router.get("/api/providers/kilo/free-models", () => ({ models: KILO_FREE_MODELS, cached: true }));

  router.get("/api/providers/suggested-models", ({ query }) => {
    if (!query.url || !query.type) return badRequest("Missing url or type");
    const match = Object.entries(AI_PROVIDERS).find(([, info]) => info.modelsFetcher?.url === query.url);
    const models = match ? modelsFor({ provider: match[0] }) : [];
    return { data: models.slice(0, 40).map(({ id, name }) => ({ id, name })) };
  });

  router.put("/api/providers/reorder", ({ body = {} }) => {
    const { providerId, orderedIds } = body;
    if (!providerId) return badRequest("providerId is required");
    if (!Array.isArray(orderedIds)) return badRequest("orderedIds must be an array of strings");
    const owned = store.list(CONNECTIONS).filter((c) => c.provider === providerId).map((c) => c.id);
    if (owned.length !== orderedIds.length || !owned.every((id) => orderedIds.includes(id))) {
      return reply({ error: "orderedIds must match the provider's connection set exactly (no duplicates, none missing)" }, { status: 409 });
    }
    store.set(CONNECTIONS, store.list(CONNECTIONS).map((c) => (c.provider === providerId ? { ...c, priority: orderedIds.indexOf(c.id) + 1 } : c)));
    return { ok: true };
  });

  router.post("/api/providers/validate", ({ body = {} }) => {
    if (!body.provider || (!body.apiKey && body.provider !== "ollama-local")) return badRequest("Provider and API key required");
    if (/invalid|wrong|expired/i.test(String(body.apiKey || ""))) return { valid: false, error: "Invalid API key" };
    return { valid: true, error: null };
  });

  router.post("/api/providers/test-batch", ({ body = {} }) => {
    if (!body.mode) return badRequest("mode is required");
    const selected = selectForBatch(connections(store).filter((c) => c.isActive !== false), body.mode, body.providerId);
    if (!selected) return badRequest("Invalid mode. Use: provider, oauth, free, apikey, compatible, all");
    const testedAt = new Date().toISOString();
    const results = selected.map((connection) => {
      const outcome = testOutcome(connection);
      applyTestResult(store, connection, outcome);
      return {
        provider: connection.provider,
        connectionId: connection.id,
        connectionName: connection.name || connection.email || connection.provider,
        authType: connection.authType || authGroup(connection),
        valid: outcome.valid,
        latencyMs: outcome.valid ? latencyFor(connection.id) : 0,
        error: outcome.error,
        diagnosis: outcome.diagnosis,
        statusCode: outcome.statusCode,
        testedAt,
      };
    });
    const passed = results.filter((r) => r.valid).length;
    return { mode: body.mode, providerId: body.providerId || null, results, summary: { total: results.length, passed, failed: results.length - passed }, testedAt };
  });

  router.get("/api/providers/:id", ({ params }) => {
    const connection = store.find(CONNECTIONS, params.id);
    return connection ? { connection: sanitizeConnection(connection) } : notFound("Connection not found");
  });

  const update = ({ params, body = {} }) => {
    if (body.priority !== undefined && validPriority(body.priority) === null) {
      return reply({ error: { message: "Invalid request", details: [{ field: "priority", message: "Invalid value" }] } }, { status: 400 });
    }
    const existing = store.find(CONNECTIONS, params.id);
    if (!existing) return notFound("Connection not found");
    if (body.connectionProxyEnabled === true && !String(body.connectionProxyUrl || "").trim()) {
      return badRequest("Connection proxy URL is required when connection proxy is enabled");
    }
    const changes = buildUpdate(existing, body);
    const withPriority = body.priority !== undefined ? { ...changes, priority: validPriority(body.priority) } : changes;
    const withGlobal = body.globalPriority !== undefined ? { ...withPriority, globalPriority: body.globalPriority === null ? null : validPriority(body.globalPriority) } : withPriority;
    return { connection: sanitizeConnection(store.patch(CONNECTIONS, params.id, withGlobal)) };
  };
  router.put("/api/providers/:id", update);
  router.patch("/api/providers/:id", update);

  router.delete("/api/providers/:id", ({ params }) => {
    if (!store.remove(CONNECTIONS, params.id)) return notFound("Connection not found");
    return { message: "Connection deleted successfully" };
  });

  router.post("/api/providers/:id/test", ({ params }) => {
    const connection = store.find(CONNECTIONS, params.id);
    if (!connection) return notFound("Connection not found");
    const outcome = testOutcome(connection);
    applyTestResult(store, connection, outcome);
    return { valid: outcome.valid, error: outcome.error, refreshed: connection.authType === "oauth" && outcome.valid };
  });

  router.post("/api/providers/:id/test-models", ({ params }) => {
    const connection = store.find(CONNECTIONS, params.id);
    if (!connection) return notFound("Connection not found");
    const outcome = testOutcome(connection);
    const results = modelsFor(connection).slice(0, 12).map((model) => ({
      modelId: model.id, name: model.name, ok: outcome.valid, latencyMs: outcome.valid ? latencyFor(`${connection.id}/${model.id}`) : 0, error: outcome.error,
    }));
    return { provider: connection.provider, connectionId: connection.id, results };
  });

  router.get("/api/providers/:id/models", ({ params }) => {
    const connection = store.find(CONNECTIONS, params.id);
    if (!connection) return notFound("Connection not found");
    return { models: modelsFor(connection) };
  });

  router.patch("/api/providers/:id/auto-ping", ({ params, body = {} }) => {
    if (typeof body.enabled !== "boolean") return badRequest("enabled must be a boolean");
    const connection = store.find(CONNECTIONS, params.id);
    if (!connection) return notFound("Connection not found");
    if (!isAutoPingEligible(connection) || (body.enabled && connection.isActive === false)) {
      return badRequest("Auto-ping is available only for active Claude or Codex OAuth connections");
    }
    const settingsKey = connection.provider === "claude" ? "claudeAutoPing" : "codexAutoPing";
    const updated = store.patch(CONNECTIONS, params.id, { autoPingEnabled: body.enabled });
    const peers = store.list(CONNECTIONS).filter((c) => c.provider === connection.provider && c.autoPingEnabled !== undefined);
    return {
      connectionId: updated.id,
      provider: updated.provider,
      enabled: body.enabled,
      settingsKey,
      config: { enabled: peers.some((c) => c.autoPingEnabled), connections: Object.fromEntries(peers.map((c) => [c.id, c.autoPingEnabled])) },
    };
  });
}
