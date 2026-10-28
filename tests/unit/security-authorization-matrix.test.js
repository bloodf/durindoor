import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1115: real auth, ownership, model/combo resolution, policy, account selection
// and handler routing. HTTP rewriting is covered by the separate HTTP runner.
const fixture = vi.hoisted(() => ({ keys: new Map(), scopes: new Map(), owners: new Map(), connections: [], settings: {}, combo: null, fetch: vi.fn(), core: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: () => { throw new Error("Unexpected database access in authorization matrix"); },
  getAdapterSync: () => { throw new Error("Unexpected database access in authorization matrix"); },
}));
vi.mock("@/lib/apiKeyLimits.js", () => ({ enforceApiKeyLimits: async () => null }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "matrix-cli" }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: async (value) => value === "matrix-session" }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: () => false }));
vi.mock("next/server", () => ({ NextResponse: class extends Response {
  static next() { return new Response(null, { headers: { "x-matrix-next": "1" } }); }
  static json(body, init) { return Response.json(body, init); }
} }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => fixture.settings,
  getApiKeyByKey: async (secret) => fixture.keys.get(secret) ?? null,
  getApiKeyById: async (id) => [...fixture.keys.values()].find((key) => key.id === id) ?? null,
  validateApiKey: async (secret) => {
    const key = fixture.keys.get(secret);
    return !!key?.isActive && (!key.expiresAt || Date.parse(key.expiresAt) > Date.now());
  },
  validateGatewayKey: async () => false,
  getApiKeyUsageLimitStatus: async () => ({ exceeded: false }),
  getApiKeyUsageTotals: async () => ({ totalTokens: 0, totalCost: 0 }),
  saveRequestUsage: async () => true,
  getApiKeyProviderConnectionIds: async (id) => fixture.scopes.get(id) ?? [],
  getProviderConnections: async (query = {}) => fixture.connections.filter((row) => !query.provider || row.provider === query.provider),
  getProviderConnectionById: async (id) => fixture.connections.find((row) => row.id === id),
  updateProviderConnection: async (id, patch) => Object.assign(fixture.connections.find((row) => row.id === id), patch),
  getProxyPools: async () => [], getQuotaReservationPressure: async () => new Map(),
  getCombos: async () => fixture.combo ? [fixture.combo] : [],
  getComboForModel: async (name) => fixture.combo?.name.toLowerCase() === name.toLowerCase() ? fixture.combo : null,
  getComboByName: async (name) => fixture.combo?.name === name ? fixture.combo : null,
  getModelAliases: async () => ({ friendly: "openai/gpt-4o" }),
  getProviderNodes: async () => [], getCustomModels: async () => [],
  getSyncedModelCatalog: async () => null, getSyncedModelCatalogs: async () => [],
}));
// Keep actual key authentication and account scope selection; exclude live quota
// discovery/reservations from this authorization-only suite.
vi.mock("@/sse/services/auth.js", async (original) => {
  const auth = await original();
  return { ...auth, getProviderCredentialsWithQuotaPreflight: (provider, excluded, model, options) =>
    auth.getProviderCredentials(provider, excluded, model, { ...options, quotaSnapshotsLoader: async () => [], quotaFetchStateLoader: async () => [] }) };
});
vi.mock("@/sse/services/nativeResourceOwners.js", () => ({
  readNativeResourceOwner: async (provider, account, id) => fixture.owners.get(`${provider}:${account}:${id}`) ?? null,
  createNativeResourceOwner: async (owner) => { fixture.owners.set(`${owner.provider}:${owner.connectionId}:${owner.resourceId}`, owner); },
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fixture.fetch }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: fixture.core }));
vi.mock("open-sse/services/liveModelLimits.js", () => ({ warmLiveModelLimits: vi.fn() }));
vi.mock("@/lib/usageDb", () => ({ recordTokenSaverEvent: vi.fn() }));

const { proxy } = await import("@/dashboardGuard.js");
const native = await import("@/app/api/v1/native/[provider]/[...operation]/route.js");
const { NATIVE_OPERATIONS } = await import("@/sse/handlers/nativeProviderConfig.js");
const { handleChat } = await import("@/sse/handlers/chat.js");
const { default: registry } = await import("open-sse/providers/registry/index.js");
const { resetComboRotation, resetComboScoring } = await import("open-sse/services/combo.js");
const principals = ["dashboard", "cli", "owner", "foreign", "inactive", "expired", "anonymous"];
const admitted = (principal) => ["cli", "owner", "foreign"].includes(principal);
const paths = ["canonical", "alias", "double-v1", "encoded"];
function spelling(path, variant) {
  if (variant === "canonical") return `/api${path}`;
  if (variant === "double-v1") return `/v1${path}`;
  if (variant === "encoded") return path.replace(/[a-z0-9]/gi, (char) => `%${char.charCodeAt(0).toString(16)}`);
  return path;
}
function request(path, principal, method = "GET", body, headers = {}) {
  const req = new Request(`http://matrix.invalid${path}`, { method, headers: {
    host: "matrix.invalid", "content-type": "application/json",
    ...(["owner", "foreign", "inactive", "expired"].includes(principal) ? { authorization: `Bearer matrix-${principal}` } : {}),
    ...(principal === "cli" ? { "x-9r-cli-token": "matrix-cli" } : {}),
    ...(principal === "dashboard" ? { cookie: "auth_token=matrix-session" } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  req.nextUrl = new URL(req.url);
  req.cookies = { get: () => principal === "dashboard" ? { value: "matrix-session" } : undefined };
  return req;
}
async function guarded(req, handler) {
  const gate = await proxy(req);
  return gate.headers.get("x-matrix-next") === "1" ? handler(req) : gate;
}
function own(provider, id, ownerId) { fixture.owners.set(`${provider}:${provider}-account:${id}`, { ownerId }); }
function nativeRequest(op, principal, extra = {}) {
  const path = op.path.replace(/\{[^}]+\}/g, "resource");
  const model = registry.find((entry) => entry.id === op.provider)?.models[0]?.id;
  if (!model) throw new Error(`Missing registry fixture model: ${op.provider}`);
  const query = new URLSearchParams({ model: `${op.provider}/${model}`, ...(op.resourceQuery ? { [op.resourceQuery]: "resource" } : {}) });
  const body = op.method === "POST" ? (op.resourceBodyField ? { [op.resourceBodyField]: "resource" } : {}) : undefined;
  const req = request(`/api/v1/native/${op.provider}${path}?${query}`, principal, op.method, body, { "x-connection-id": `${op.provider}-account`, ...extra });
  return native[op.method](req, { params: Promise.resolve({ provider: op.provider, operation: path.slice(1).split("/") }) });
}
const operations = Object.entries(NATIVE_OPERATIONS).flatMap(([provider, rows]) => rows
  .filter((op) => op.createsResource || op.listsResources || op.resourceParam || op.resourceQuery || op.resourceBodyField)
  .map((op) => ({ ...op, provider, label: `${provider} ${op.method} ${op.path}` })));
const tracked = operations.filter((op) => op.resourceParam || op.resourceQuery || op.resourceBodyField);
const completion = { id: "matrix", choices: [{ message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access in authorization matrix"); }));
  resetComboRotation(); resetComboScoring();
  fixture.keys.clear(); fixture.scopes.clear(); fixture.owners.clear(); fixture.combo = null;
  fixture.settings = { requireApiKey: true, requireLogin: true, comboStrategy: "fallback", visionBridgeEnabled: false };
  for (const principal of ["owner", "foreign", "inactive", "expired"]) fixture.keys.set(`matrix-${principal}`, {
    id: principal, key: `matrix-${principal}`, name: principal, isActive: principal !== "inactive",
    expiresAt: principal === "expired" ? "2000-01-01T00:00:00Z" : null, policy: {},
  });
  fixture.connections = Object.keys(NATIVE_OPERATIONS).map((provider) => ({ id: `${provider}-account`, provider, authType: "apikey", apiKey: "matrix-upstream", isActive: true, priority: 1, providerSpecificData: {} }));
  fixture.fetch.mockImplementation(async () => Response.json({ id: "resource", task_id: "resource", request_id: "resource", voice_id: "resource", file: { file_id: "resource" } }));
  fixture.core.mockImplementation(async () => ({ success: true, response: Response.json(completion) }));
});
afterEach(() => vi.unstubAllGlobals());

// Path/principal classification only: no fabricated rewrite or decoded route
// params. The companion HTTP runner proves actual framework routing separately.
describe.each(paths)("#1115 guard %s", (variant) => {
  it.each(principals)("classifies %s across native resources and chat aliases", async (principal) => {
    const leaves = [...new Set(operations.map((op) => `/v1/native/${op.provider}${op.path.replace(/\{[^}]+\}/g, "resource")}`)), "/v1/chat/completions", "/responses", "/codex/chat"];
    for (const path of leaves) {
      const actual = path.startsWith("/v1/") ? spelling(path, variant) : variant === "encoded" ? spelling(path, variant) : path;
      const response = await proxy(request(actual, principal));
      expect(response.headers.get("x-matrix-next"), actual).toBe(admitted(principal) ? "1" : null);
      if (!admitted(principal)) expect(response.status, actual).toBe(401);
    }
  });
});

describe.each(principals)("#1115 native principal %s", (principal) => {
  it.each(operations)("$label", async (op) => {
    own(op.provider, "resource", "owner"); own(op.provider, "foreign-resource", "foreign");
    if (op.listsResources) fixture.fetch.mockImplementation(async () => Response.json({ data: [{ id: "resource" }, { id: "foreign-resource" }, { id: "unknown" }], first_id: "resource", last_id: "unknown", has_more: false, total: 3 }));
    const response = await nativeRequest(op, principal);
    const foreignDenied = tracked.includes(op) && principal === "foreign";
    expect(response.status).toBe(!admitted(principal) ? 401 : foreignDenied ? 403 : 200);
    if (!admitted(principal) || foreignDenied) { expect(fixture.fetch).not.toHaveBeenCalled(); return; }
    const payload = await response.json();
    if (op.listsResources) {
      const ids = principal === "cli" ? ["resource", "foreign-resource"] : [principal === "owner" ? "resource" : "foreign-resource"];
      expect(payload).toEqual({ data: ids.map((id) => ({ id })), first_id: ids[0], last_id: ids.at(-1), has_more: false });
    }
    if (op.createsResource) expect(fixture.owners.get(`${op.provider}:${op.provider}-account:resource`)?.ownerId).toBe(principal === "cli" ? "operator" : principal);
    for (const [, init] of fixture.fetch.mock.calls) {
      expect(init.headers.get("cookie")).toBeNull(); expect(init.headers.get("x-9r-cli-token")).toBeNull();
    }
  });
  it.each(tracked)("unknown owner fails closed: $label", async (op) => {
    expect((await nativeRequest(op, principal)).status).toBe(admitted(principal) ? 403 : 401);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
});

const chatBody = (mode) => ({ model: mode === "reroute" ? "minimax/MiniMax-M2.1" : mode === "combo" ? "MATRIX-COMBO" : "friendly", messages: [{ role: "user", content: mode === "reroute" ? [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] : "hello" }] });
function combo() {
  fixture.combo = { id: "matrix-combo-id", name: "matrix-combo", models: ["openai/gpt-4o"], members: [{ id: "openai/gpt-4o", weight: 1 }], allowedConnectionIds: ["openai-account"] };
}
describe.each(["direct", "reroute", "combo"])("#1115 %s dispatch", (mode) => {
  describe.each(principals)("principal %s", (principal) => {
    it.each(["allowed", "model-denied", "account-denied", "combo-denied"])("enforces %s", async (scope) => {
      combo(); fixture.settings.visionBridgeEnabled = mode === "reroute"; fixture.settings.visionBridgeModel = "openai/gpt-4o";
      for (const key of fixture.keys.values()) {
        key.policy = scope === "model-denied" ? { allowedModels: ["minimax/MiniMax-M2.1"] } : {};
        key.allowedCombos = [scope === "combo-denied" ? "other" : "matrix-combo"];
        if (scope === "account-denied") fixture.scopes.set(key.id, ["minimax-account"]);
      }
      const response = await guarded(request("/api/v1/chat/completions", principal, "POST", chatBody(mode)), handleChat);
      const denied = !admitted(principal) || principal !== "cli" && (scope === "account-denied" || scope === "model-denied" && mode !== "reroute" || scope === "combo-denied" && mode === "combo");
      if (denied) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        if (!admitted(principal)) expect(response.status).toBe(401);
        expect(fixture.core).not.toHaveBeenCalled();
      } else {
        expect(response.status).toBe(200); expect(await response.json()).toEqual(completion);
        expect(fixture.core).toHaveBeenCalledOnce();
        expect(fixture.core.mock.calls[0][0].modelInfo.provider).toBe(scope === "model-denied" && mode === "reroute" && principal !== "cli" ? "minimax" : "openai");
      }
    });
  });
});

it.each(["model-denied", "account-disjoint"])("intersects combo member %s with key scope", async (scope) => {
  combo(); fixture.scopes.set("owner", ["openai-account"]);
  if (scope === "account-disjoint") fixture.combo.allowedConnectionIds = ["minimax-account"];
  else fixture.keys.get("matrix-owner").policy = { allowedModels: ["minimax/MiniMax-M2.1"] };
  const response = await handleChat(request("/api/v1/chat/completions", "owner", "POST", chatBody("combo")));
  expect(response.status).toBeGreaterThanOrEqual(400); expect(fixture.core).not.toHaveBeenCalled();
});

it.each([false, true])("preserves local anonymous ownership (requireApiKey=%s)", async (required) => {
  fixture.settings.requireApiKey = required;
  const op = tracked.find((row) => row.provider === "anthropic" && row.path === "/v1/files/{id}");
  for (const owner of ["local", "owner"]) {
    fixture.fetch.mockClear(); own("anthropic", "resource", owner);
    const response = await nativeRequest(op, "anonymous");
    expect(response.status).toBe(required ? 401 : owner === "local" ? 200 : 403);
    if (required || owner !== "local") expect(fixture.fetch).not.toHaveBeenCalled();
  }
  expect((await proxy(request("/v1/native/anthropic/v1/files/resource", "anonymous"))).status).toBe(401);
});

it.each(["/v1/native/%", "/api/v1/%GG", "/v1/%E0%A4%A"])("rejects malformed encoding %s", async (path) => {
  expect((await proxy(request(path, "cli"))).status).toBe(401);
});

// Needs independent reproduction; do not change source from inspection alone.
it("uses the authenticated x-api-key owner when Bearer is stale", async () => {
  own("anthropic", "resource", "owner");
  const op = tracked.find((row) => row.provider === "anthropic" && row.path === "/v1/files/{id}");
  const response = await nativeRequest(op, "owner", { authorization: "Bearer stale-placeholder", "x-api-key": "matrix-owner" });
  expect(response.status).toBe(200);
  expect((await response.json()).id).toBe("resource");
});

describe.each(["owner", "foreign", "cli"])("#1115 native scope %s", (principal) => {
  it.each(tracked)("enforces account and model scope: $label", async (op) => {
    own(op.provider, "resource", principal === "cli" ? "owner" : principal);
    for (const boundary of ["model", "account"]) {
      fixture.fetch.mockClear(); fixture.scopes.clear();
      const key = fixture.keys.get(`matrix-${principal}`);
      if (key) key.policy = boundary === "model" ? { allowedModels: ["not-allowed/model"] } : {};
      if (boundary === "account") fixture.scopes.set(principal, ["outside-account"]);
      const response = await nativeRequest(op, principal);
      expect(response.status).toBe(principal === "cli" ? 200 : boundary === "model" ? 403 : 503);
      if (principal !== "cli") expect(fixture.fetch).not.toHaveBeenCalled();
      else await response.text();
    }
  });
});

it.each(tracked)("rejects cross-provider substitution: $label", async (op) => {
  const path = op.path.replace(/\{[^}]+\}/g, "resource");
  const other = op.provider === "openai" ? "anthropic/claude-haiku-4-5" : "openai/gpt-4o";
  const req = request(`/api/v1/native/${op.provider}${path}?model=${other}`, "owner", op.method,
    op.method === "POST" ? {} : undefined, { "x-connection-id": `${op.provider}-account` });
  const response = await native[op.method](req, { params: Promise.resolve({ provider: op.provider, operation: path.slice(1).split("/") }) });
  expect(response.status).toBe(400); expect(fixture.fetch).not.toHaveBeenCalled();
});
