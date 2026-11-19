import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

// A stalled node must hit the executor's connect timeout quickly instead of
// waiting out the production default.
const PREVIOUS_OLLAMA_TIMEOUT = process.env.OLLAMA_LOCAL_CONNECT_TIMEOUT_MS;
process.env.OLLAMA_LOCAL_CONNECT_TIMEOUT_MS = "400";

/**
 * #2024 — fail over to the next node when the chosen one fails.
 *
 * The nodes are real in-process HTTP servers: one of them is unhealthy (503,
 * closed or stalled), the other one serves the model. The gateway runs its
 * normal chat path, so the connection selection, the fallback classification
 * and the per-connection health state are all exercised as in production.
 */

const mocks = vi.hoisted(() => ({
  connections: [],
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  recordProviderConnectionFallbackState: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: vi.fn(async () => null),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyUsageLimitStatus: vi.fn(async () => ({ enforced: false, exceeded: false })),
  validateApiKey: vi.fn(async () => true),
  updateProviderConnection: mocks.updateProviderConnection,
  recordProviderConnectionFallbackState: mocks.recordProviderConnectionFallbackState,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(async () => []),
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  listProviderQuotaSnapshots: vi.fn(async () => []),
  getQuotaFetchState: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getComboForModel: vi.fn(async () => null),
  getComboByName: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => []),
  getProviderNodes: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getSyncedModelCatalogs: vi.fn(async () => []),
}));

vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/db/repos/usageRepo.js", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    getBillingEpoch: vi.fn(async () => null),
    statsEmitter: new EventEmitter(),
    getApiKeyWindowUsageTotals: vi.fn(async () => ({ total: 0, inputTokens: 0, outputTokens: 0 })),
  };
});
vi.mock("@/lib/usageDb.js", () => ({
  recordTokenSaverEvent: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveUsageStats: vi.fn(async () => {}),
}));

/**
 * Start an in-process Ollama node. `chatStatus` decides how /api/chat answers;
 * `stall` keeps the request open so the executor hits its connect timeout.
 */
async function startOllamaNode({ models = [], chatStatus = 200, content = "ok", stall = false } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        models: models.map((name) => ({ name, model: name, capabilities: ["completion"] })),
      }));
      return;
    }
    if (req.url === "/api/ps") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    if (req.url === "/api/show") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ capabilities: ["completion"] }));
      return;
    }
    if (req.url === "/api/chat") {
      if (stall) return;
      res.writeHead(chatStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: models[0] || "llama3.2",
        created_at: new Date(0).toISOString(),
        message: { role: "assistant", content },
        done: true,
        done_reason: "stop",
        eval_count: 1,
        prompt_eval_count: 1,
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    host: `http://127.0.0.1:${port}`,
    requests,
    chatRequests: () => requests.filter((url) => url === "/api/chat").length,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function ollamaConnection(id, host, priority) {
  return {
    id,
    provider: "ollama-local",
    authType: "none",
    isActive: true,
    priority,
    providerSpecificData: { baseUrl: host },
  };
}

async function callChat(model = "ollama-local/llama3.2") {
  const { handleChat } = await import("../../src/sse/handlers/chat.js");
  return handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  }));
}

describe("network node failover (#2024)", () => {
  const nodes = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connections = [];
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
    mocks.updateProviderConnection.mockImplementation(async (id, updates) => ({ id, ...updates }));
    mocks.getProviderConnections.mockImplementation(async ({ provider } = {}) =>
      mocks.connections.filter((connection) => !provider || connection.provider === provider));
    // Persist the per-connection health state the way the repository does, so
    // the next request sees the failed node as benched.
    mocks.recordProviderConnectionFallbackState.mockImplementation(async (id, state = {}) => {
      const connection = mocks.connections.find((row) => row.id === id);
      const key = state.model ? `modelLock_${state.model}` : "modelLock___all";
      if (connection) {
        connection[key] = new Date(Number(state.observedAt || Date.now()) + Number(state.cooldownMs || 0)).toISOString();
      }
      return { applied: true };
    });
  });

  afterEach(async () => {
    while (nodes.length) await nodes.pop().close();
  });

  afterAll(() => {
    // The shortened timeout belongs to this file only.
    if (PREVIOUS_OLLAMA_TIMEOUT === undefined) delete process.env.OLLAMA_LOCAL_CONNECT_TIMEOUT_MS;
    else process.env.OLLAMA_LOCAL_CONNECT_TIMEOUT_MS = PREVIOUS_OLLAMA_TIMEOUT;
  });

  async function node(options) {
    const started = await startOllamaNode(options);
    nodes.push(started);
    return started;
  }

  it("sends the request only to the node that serves the model", async () => {
    const alpha = await node({ models: ["alpha:1b"], content: "alpha node" });
    const beta = await node({ models: ["beta:1b"], content: "beta node" });
    mocks.connections = [
      ollamaConnection("conn-alpha", alpha.host, 1),
      ollamaConnection("conn-beta", beta.host, 2),
    ];

    const response = await callChat("ollama-local/beta:1b");

    expect(response.status).toBe(200);
    expect(alpha.chatRequests()).toBe(0);
    expect(beta.chatRequests()).toBe(1);
    const payload = await response.json();
    expect(payload.choices?.[0]?.message?.content).toContain("beta node");
  });

  it("fails over to the next node when the chosen one answers 5xx", async () => {
    const broken = await node({ models: ["llama3.2"], chatStatus: 503 });
    const healthy = await node({ models: ["llama3.2"], content: "served by the healthy node" });
    mocks.connections = [
      ollamaConnection("conn-broken", broken.host, 1),
      ollamaConnection("conn-healthy", healthy.host, 2),
    ];

    const response = await callChat();

    expect(response.status).toBe(200);
    expect(broken.chatRequests()).toBe(1);
    expect(healthy.chatRequests()).toBe(1);
    const payload = await response.json();
    expect(payload.choices?.[0]?.message?.content).toContain("served by the healthy node");
  });

  it("fails over to the next node when the chosen one is unreachable", async () => {
    const unreachable = await node({ models: ["llama3.2"] });
    await unreachable.close();
    nodes.pop();
    const healthy = await node({ models: ["llama3.2"], content: "served after the refused node" });
    mocks.connections = [
      ollamaConnection("conn-unreachable", unreachable.host, 1),
      ollamaConnection("conn-healthy", healthy.host, 2),
    ];

    const response = await callChat();

    expect(response.status).toBe(200);
    expect(healthy.chatRequests()).toBe(1);
    const payload = await response.json();
    expect(payload.choices?.[0]?.message?.content).toContain("served after the refused node");
  });

  it("fails over to the next node when the chosen one times out", async () => {
    const stalled = await node({ models: ["llama3.2"], stall: true });
    const healthy = await node({ models: ["llama3.2"], content: "served after the stalled node" });
    mocks.connections = [
      ollamaConnection("conn-stalled", stalled.host, 1),
      ollamaConnection("conn-healthy", healthy.host, 2),
    ];

    const response = await callChat();

    expect(response.status).toBe(200);
    expect(stalled.chatRequests()).toBe(1);
    expect(healthy.chatRequests()).toBe(1);
    const payload = await response.json();
    expect(payload.choices?.[0]?.message?.content).toContain("served after the stalled node");
  });

  it("does not fail over on a 4xx client error", async () => {
    const rejecting = await node({ models: ["llama3.2"], chatStatus: 400 });
    const healthy = await node({ models: ["llama3.2"], content: "must not be used" });
    mocks.connections = [
      ollamaConnection("conn-rejecting", rejecting.host, 1),
      ollamaConnection("conn-healthy", healthy.host, 2),
    ];

    const response = await callChat();

    expect(response.status).toBe(400);
    expect(rejecting.chatRequests()).toBe(1);
    expect(healthy.chatRequests()).toBe(0);
  });

  it("keeps the unhealthy node benched while the healthy node still serves", async () => {
    const broken = await node({ models: ["llama3.2"], chatStatus: 503 });
    const healthy = await node({ models: ["llama3.2"], content: "still serving" });
    mocks.connections = [
      ollamaConnection("conn-broken", broken.host, 1),
      ollamaConnection("conn-healthy", healthy.host, 2),
    ];

    const first = await callChat();
    expect(first.status).toBe(200);
    expect(broken.chatRequests()).toBe(1);

    const second = await callChat();

    expect(second.status).toBe(200);
    // The failed node stays benched, the healthy one keeps serving.
    expect(broken.chatRequests()).toBe(1);
    expect(healthy.chatRequests()).toBe(2);
  });
});
