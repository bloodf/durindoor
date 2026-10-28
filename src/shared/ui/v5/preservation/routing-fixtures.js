import { MEDIA_ROUTE_KINDS } from "../../../constants/mediaRoutes.js";

/** Isolated synthetic routing data. This module never imports server repositories. */
const clone = (value) => structuredClone(value);
export const ROUTING_MODEL_IDS = ["openai/gpt-4o", "anthropic/claude-sonnet-4.5"];
export const ROUTING_STRATEGIES = ["fallback", "round-robin", "weighted", "smart-scoring", "smart", "fusion"];
export const ROUTING_CONNECTION = {
  id: "review-account", provider: "openai", authType: "apikey", name: "Review account",
  isActive: true, priority: 1, testStatus: "active", createdAt: "2026-10-01T12:00:00Z",
  apiKey: "SYNTHETIC_REVIEW_SECRET", sessionToken: "SYNTHETIC_SESSION_SECRET",
  providerSpecificData: { retainedField: "keep", region: "us-east-1" },
};
export const ROUTING_KEY = {
  id: "review-key", name: "Restricted review client", maskedKey: "dd_review_••••0000",
  isActive: false, createdAt: "2026-10-01T12:00:00Z", expiresAt: "2099-12-31T23:00:00.000Z",
  allowedCombos: ["review-route"], providerConnectionIds: ["review-account"], groupIds: ["review-label"],
  dailyLimitTokens: 12000,
  policy: { allowedModels: ["openai/gpt-4o"], maxTokens: 60000, maxCostUsd: 12, rpmLimit: 15, monthlyBudget: 8 },
  usage: { totalTokens: 300, totalCost: 0.02, totalRequests: 2 },
};
const POOL = { id: "review-pool", name: "Strict office proxy", proxyUrl: "http://synthetic.example.test:8080", noProxy: "localhost,.internal.test", strictProxy: true, isActive: true, boundConnectionCount: 1, testStatus: "active", lastTestedAt: "2026-10-01T12:00:00Z" };

/** Each story owns a factory and resets it before rendering. Writes round-trip through exact routes. */
export function createRoutingFixture(options = {}) {
  let state;
  const reset = () => {
    const provider = options.provider || "openai";
    state = {
      connections: clone(options.connections || [{ ...ROUTING_CONNECTION, provider }]),
      keys: clone(options.keys || [ROUTING_KEY]), pools: clone(options.pools || [POOL]),
      combos: clone(options.combos || [{ id: "review-combo", name: "review-route", models: [...ROUTING_MODEL_IDS], members: ROUTING_MODEL_IDS.map((id, index) => ({ id, weight: index + 1 })), capabilities: { tools: false, contextWindow: 32000 }, allowedConnectionIds: ["review-account"] }]),
      groups: [{ id: "review-group", name: "Review accounts", connectionIds: ["review-account"] }],
      keyGroups: [{ id: "review-label", name: "Review clients" }],
      enabledModels: clone(options.enabledModels || ["review-missing-model"]), disabledModels: [],
      customModels: [{ id: "review-custom", providerAlias: "openai", type: "llm", capabilities: { tools: true, contextWindow: 64000 } }],
      settings: { theme: "dark", requireApiKey: true, requireLogin: true, hasPassword: true, tunnelDashboardAccess: false, disabledFreeProviders: [], providerStrategies: {}, providerThinking: {}, providerConcurrencyLimits: {}, retryDelayByProvider: {}, rpmByProvider: {}, providerErrorRules: {}, modelAutoSyncProviders: { openai: true }, comboStrategies: { "review-route": { fallbackStrategy: options.strategy || "fallback", timeoutMs: 12000, judgeModel: options.strategy === "fusion" ? "openai/gpt-4o" : "" } }, ...clone(options.settings || {}) },
      tunnel: clone(options.tunnel || { enabled: false, tunnelUrl: "", publicUrl: "", allUrls: [] }),
      tailscale: clone(options.tailscale || { enabled: false, tunnelUrl: "" }),
      sync: { eligible: true, enabled: true, models: [{ id: "gpt-4o", name: "GPT-4o" }], newModelIds: ["gpt-4o"], removedModelIds: ["retired-review-model"], syncedAt: "2026-10-01T12:00:00Z", error: options.syncError || null },
      mediaRoutes: MEDIA_ROUTE_KINDS.map(({ id, label, endpoint }) => ({ id, label, endpoint, saved: options.mediaCustom ? [`review/${id}-a`, "review/unavailable-model"] : [], candidates: [{ id: `review/${id}-a`, name: `${id} model A`, provider: "review" }, { id: `review/${id}-b`, name: `${id} model B`, provider: "review" }], effective: options.mediaCustom ? [`review/${id}-a`] : [`review/${id}-a`, `review/${id}-b`], endpoints: id === "video" ? [{ path: "/v1/videos", effective: [`review/${id}-a`] }] : [] })),
      writes: [], requests: [],
    };
  };
  reset();
  const routes = {};
  const add = (method, path, handler) => {
    const key = `${method} ${path}`;
    routes[key] = async (request) => {
      const payload = method === "GET" || method === "DELETE" ? null : await request.json().catch(() => null);
      state.requests.push({ key, url: request.url, payload: clone(payload) });
      if (options.pending?.includes(key)) return new Promise(() => {});
      if (options.failures?.[key]) return { status: 503, body: { error: options.failures[key] } };
      const result = await handler(payload, request);
      if (method !== "GET" && (result.status || 200) < 400) state.writes.push({ key, payload: clone(payload) });
      return result;
    };
  };
  const body = (value) => ({ body: clone(value) });
  const publicConnection = ({ apiKey: _apiKey, sessionToken: _sessionToken, ...connection }) => connection;
  add("GET", "/api/providers", () => body({ connections: state.connections.map(publicConnection) }));
  add("POST", "/api/providers/validate", () => body({ valid: true }));
  add("POST", "/api/providers", (payload) => {
    const connection = { id: `review-account-${state.connections.length + 1}`, ...payload, isActive: payload.isActive ?? true };
    state.connections.push(connection);
    return body({ connection: publicConnection(connection) });
  });
  add("GET", "/api/provider-nodes", () => body({ nodes: [{ id: "oc-review", name: "Review compatible", type: "openai-compatible", prefix: "oc-review", apiType: "responses", baseUrl: "https://provider.example.test/v1" }] }));
  for (const connection of state.connections) {
    const path = `/api/providers/${connection.id}`;
    add("PUT", path, (payload) => {
      const index = state.connections.findIndex((item) => item.id === connection.id);
      const previous = state.connections[index];
      state.connections[index] = { ...previous, ...payload, providerSpecificData: { ...previous.providerSpecificData, ...payload.providerSpecificData } };
      return body({ connection: publicConnection(state.connections[index]), success: true });
    });
    add("DELETE", path, () => { state.connections = state.connections.filter((item) => item.id !== connection.id); return body({ success: true }); });
    add("POST", `${path}/test`, () => body({ valid: true, success: true, testStatus: "active" }));
    add("GET", `${path}/models`, () => body({ models: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "text-embedding-3-small", name: "Review embedding" }] }));
    add("GET", `/api/usage/${connection.id}`, () => body({ plan: "Plus", limits: [] }));
  }
  add("GET", "/api/settings", () => body(state.settings));
  for (const method of ["PATCH", "PUT"]) add(method, "/api/settings", (payload) => { state.settings = { ...state.settings, ...payload }; return body(state.settings); });
  add("GET", "/api/tunnel/status", () => body({ tunnel: state.tunnel, tailscale: state.tailscale }));
  add("GET", "/api/tunnel/ping", () => body({ reachable: true, ok: true }));
  add("POST", "/api/tunnel/disable", () => { state.tunnel.enabled = false; return body({ success: true }); });
  add("GET", "/api/tunnel/tailscale-check", () => body({ installed: true, running: true, loggedIn: true, funnelEnabled: state.tailscale.enabled }));
  add("POST", "/api/tunnel/tailscale-disable", () => { state.tailscale.enabled = false; return body({ success: true }); });
  add("GET", "/api/models", () => body({ models: ROUTING_MODEL_IDS.map((fullModel) => ({ fullModel, model: fullModel.split("/")[1], caps: { tools: true, contextWindow: 128000, maxOutput: 16000 } })) }));
  add("GET", "/api/models/alias", () => body({ aliases: {} }));
  add("GET", "/api/models/custom", () => body({ models: state.customModels }));
  add("GET", "/api/models/enabled", () => body({ ids: state.enabledModels }));
  add("PUT", "/api/models/enabled", (payload) => { state.enabledModels = payload.ids; return body({ ids: state.enabledModels }); });
  add("GET", "/api/models/disabled", () => body({ ids: state.disabledModels }));
  add("POST", "/api/models/disabled", (payload) => { state.disabledModels.push(payload.id); return body({ ids: state.disabledModels }); });
  add("DELETE", "/api/models/disabled", () => { state.disabledModels = []; return body({ ids: [] }); });
  add("POST", "/api/models/test", () => body({ ok: true, valid: true }));
  add("GET", "/api/models/auto-sync", () => body({ providers: { [options.provider || "openai"]: { ...state.sync, enabled: state.settings.modelAutoSyncProviders[options.provider || "openai"] !== false } } }));
  add("POST", "/api/models/auto-sync", () => body({ results: [{ status: options.syncError ? "failed" : "synced", modelCount: state.sync.models.length, error: options.syncError || null }] }));
  add("GET", "/api/combos", () => body({ combos: state.combos }));
  add("POST", "/api/combos", (payload) => { const combo = { id: `review-combo-${state.combos.length + 1}`, ...payload }; state.combos.push(combo); return body({ combo }); });
  for (const combo of state.combos) {
    add("PUT", `/api/combos/${combo.id}`, (payload) => { const next = { ...state.combos.find((item) => item.id === combo.id), ...payload }; state.combos = state.combos.map((item) => item.id === combo.id ? next : item); return body({ combo: next }); });
    add("DELETE", `/api/combos/${combo.id}`, () => { state.combos = state.combos.filter((item) => item.id !== combo.id); return body({ success: true }); });
  }
  add("GET", "/api/connection-groups", () => body({ groups: state.groups }));
  add("POST", "/api/connection-groups", (payload) => { const group = { id: "review-group-created", connectionIds: [], ...payload }; state.groups.push(group); return body({ group }); });
  for (const id of ["review-group", "review-group-created"]) {
    add("PUT", `/api/connection-groups/${id}`, (payload) => { state.groups = state.groups.map((group) => group.id === id ? { ...group, ...payload } : group); return body({ group: state.groups.find((group) => group.id === id) }); });
    add("DELETE", `/api/connection-groups/${id}`, () => { state.groups = state.groups.filter((group) => group.id !== id); return body({ success: true }); });
  }
  add("GET", "/api/keys", () => body({ keys: state.keys, groups: state.keyGroups, providerConnections: state.connections.map(publicConnection) }));
  add("GET", "/api/keys/usage", () => body({ usage: Object.fromEntries(state.keys.map((key) => [key.id, { ...key.usage, rpm: { used: 2, limit: key.policy?.rpmLimit || null }, limits: [] }])) }));
  add("GET", "/api/keys/policy-catalog", () => body({ models: ROUTING_MODEL_IDS.map((id) => ({ id, name: id, displayId: id })) }));
  add("POST", "/api/key-groups", (payload) => { const group = { id: "review-created-label", ...payload }; state.keyGroups.push(group); return body({ group }); });
  for (const id of ["review-label", "review-created-label"]) {
    add("PUT", `/api/key-groups/${id}`, (payload) => { state.keyGroups = state.keyGroups.map((group) => group.id === id ? { ...group, ...payload } : group); return body({ group: state.keyGroups.find((group) => group.id === id) }); });
    add("DELETE", `/api/key-groups/${id}`, () => { state.keyGroups = state.keyGroups.filter((group) => group.id !== id); state.keys = state.keys.map((key) => ({ ...key, groupIds: (key.groupIds || []).filter((groupId) => groupId !== id) })); return body({ success: true }); });
  }
  add("POST", "/api/keys", (payload) => { const key = { ...clone(ROUTING_KEY), ...payload, id: "review-created-key", isActive: true }; state.keys.push(key); return body({ key: "dd_review_SYNTHETIC_ONLY", expiresAt: key.expiresAt }); });
  for (const key of state.keys) {
    add("PUT", `/api/keys/${key.id}`, (payload) => {
      const previous = state.keys.find((item) => item.id === key.id);
      const policyFields = ["allowedModels", "modelAccess", "maxTokens", "maxCostUsd", "rpmLimit", "tpmLimit", "dailyInputTokenLimit", "dailyOutputTokenLimit", "monthlyTokenLimit", "monthlyInputTokenLimit", "monthlyOutputTokenLimit", "monthlyRequestLimit", "monthlyBudget"];
      const policyPatch = Object.fromEntries(policyFields.filter((field) => Object.hasOwn(payload, field)).map((field) => [field, payload[field]]));
      const next = { ...previous, ...payload, policy: { ...previous.policy, ...payload.policy, ...policyPatch } };
      state.keys = state.keys.map((item) => item.id === key.id ? next : item);
      return body({ key: next });
    });
    add("DELETE", `/api/keys/${key.id}`, () => { state.keys = state.keys.filter((item) => item.id !== key.id); return body({ success: true }); });
    add("GET", `/api/keys/${key.id}/reveal`, () => body({ key: "dd_review_SYNTHETIC_ONLY" }));
  }
  add("GET", "/api/media-providers/routes", () => body({ routes: state.mediaRoutes }));
  add("PUT", "/api/media-providers/routes", (payload) => {
    const route = state.mediaRoutes.find((item) => item.id === payload.kind);
    if (!route) return { status: 400, body: { error: "Unknown media route kind" } };
    route.saved = payload.models;
    route.effective = payload.models.length ? payload.models.filter((id) => route.candidates.some((candidate) => candidate.id === id)) : route.candidates.map((candidate) => candidate.id);
    return body({ route });
  });
  add("GET", "/api/proxy-pools", () => body({ proxyPools: state.pools }));
  add("POST", "/api/proxy-pools", (payload) => { const pool = { ...payload, id: `review-pool-${state.pools.length + 1}`, boundConnectionCount: 0 }; state.pools.push(pool); return body({ proxyPool: pool, success: true }); });
  for (const service of ["vercel", "cloudflare"]) add("POST", `/api/proxy-pools/${service}-deploy`, () => body({ deployUrl: `https://${service}.example.test/review-relay` }));
  for (const pool of state.pools) {
    add("PUT", `/api/proxy-pools/${pool.id}`, (payload) => { Object.assign(state.pools.find((item) => item.id === pool.id), payload); return body({ success: true }); });
    add("POST", `/api/proxy-pools/${pool.id}/test`, () => body({ ok: true }));
    add("DELETE", `/api/proxy-pools/${pool.id}`, () => {
      if (pool.boundConnectionCount) return { status: 409, body: { error: "Proxy pool is bound to a review account" } };
      state.pools = state.pools.filter((item) => item.id !== pool.id); return body({ success: true });
    });
  }
  add("GET", "/api/oauth/xiaomi-mimo/auto-import", () => body(options.mimoFound ? { found: true, apiKey: "SYNTHETIC_MIMO", uid: "review-mimo-user", baseUrl: "https://mimo.example.test", mimoPassToken: "SYNTHETIC_PASS", mimoUserId: "review-mimo-user", mimoCUserId: "review-mimo-cuser" } : { found: false }));
  add("POST", "/api/oauth/xiaomi-mimo/api-key", (payload) => {
    const connection = { id: "review-mimo-account", provider: "xiaomi-mimo", authType: "oauth", name: "Review MiMo", isActive: true, providerSpecificData: { uid: payload.uid, region: payload.region }, apiKey: payload.apiKey || "SYNTHETIC_MIMO_BROWSER" };
    state.connections = [...state.connections.filter((item) => item.id !== connection.id), connection];
    return body({ success: true, connection: publicConnection(connection) });
  });
  add("POST", "/api/oauth/xiaomi-mimo/login/start", () => body({ pageUrl: "/assets/review-login-unavailable.html", state: "review-mimo-flow" }));
  add("GET", "/api/oauth/xiaomi-mimo/login/status", () => body({ status: "pending" }));
  add("POST", "/api/oauth/ghe-copilot/device-code", () => body({ flowId: "review-ghe-flow", device_code: "review-device", user_code: "REVIEW-CODE", verification_uri: "https://ghe.example.test/login/device", expires_in: 600, interval: 30 }));
  add("POST", "/api/oauth/ghe-copilot/poll", () => body({ error: "authorization_pending" }));
  add("POST", "/api/oauth/ghe-copilot/cancel", () => body({ success: true }));
  add("GET", "/api/oauth/orcarouter/authorize", () => body({ authUrl: "https://orca.example.test/authorize", flowId: "review-orca-flow", state: "review-orca-state" }));
  add("POST", "/api/oauth/orcarouter/exchange", (payload) => {
    if (payload.flowId !== "review-orca-flow" || payload.state !== "review-orca-state") return { status: 400, body: { error: "Review OAuth flow mismatch" } };
    const connection = { id: "review-orca-account", provider: "orcarouter", authType: "oauth", name: "Review OrcaRouter", isActive: true, apiKey: "SYNTHETIC_ORCA_OAUTH" };
    state.connections = [...state.connections.filter((item) => item.id !== connection.id), connection];
    return body({ success: true });
  });
  add("POST", "/api/oauth/orcarouter/cancel", () => body({ success: true }));
  const externalFixtures = {};
  for (const url of [state.tunnel.tunnelUrl, state.tunnel.publicUrl, ...(state.tunnel.allUrls || []), state.tailscale.tunnelUrl].filter(Boolean)) externalFixtures[`GET ${url}/api/health`] = body({ status: "ok" });
  return { routes, externalFixtures, reset, snapshot: () => clone(state) };
}
