import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

/**
 * #2024 — every OpenAI-compatible node stays its own provider, so failover
 * between two nodes is a combo concern.
 *
 * Two in-process mock nodes stand in for two OpenAI-compatible nodes: the
 * first one is closed (connection refused), the second one answers. The combo
 * must fall through to the healthy node.
 */

const mocks = vi.hoisted(() => ({
  connections: [],
  nodes: [],
  combos: [],
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  recordProviderConnectionFallbackState: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

// The transport-level in-place retry is not what this test is about: the combo
// must move on to the next node. Keeping the retry out of the way makes the
// failover the only thing that happens (and the test fast).
vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DEFAULT_RETRY_CONFIG: {
      ...actual.DEFAULT_RETRY_CONFIG,
      502: { attempts: 0, delayMs: 0 },
      503: { attempts: 0, delayMs: 0 },
      504: { attempts: 0, delayMs: 0 },
    },
  };
});

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
  getCombos: vi.fn(async () => mocks.combos),
  getComboForModel: vi.fn(async (name) => mocks.combos.find((combo) => combo.name === name) || null),
  getComboByName: vi.fn(async (name) => mocks.combos.find((combo) => combo.name === name) || null),
  getModelAliases: vi.fn(async () => []),
  getProviderNodes: vi.fn(async ({ type } = {}) =>
    (type ? mocks.nodes.filter((node) => node.type === type) : mocks.nodes)),
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

/** Start an in-process OpenAI-compatible node that answers /v1/chat/completions. */
async function startOpenAiNode({ content = "ok", status = 200 } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/v1/chat/completions") {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-node",
        object: "chat.completion",
        created: 0,
        model: "model-x",
        choices: [{
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    chatRequests: () => requests.filter((url) => url === "/v1/chat/completions").length,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function compatibleConnection(id, provider, baseUrl, priority) {
  return {
    id,
    provider,
    authType: "api_key",
    apiKey: "node-key",
    isActive: true,
    priority,
    providerSpecificData: { baseUrl },
  };
}

async function callChat(model) {
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

describe("combo failover between two OpenAI-compatible nodes (#2024)", () => {
  const nodes = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connections = [];
    mocks.nodes = [];
    mocks.combos = [];
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
    mocks.recordProviderConnectionFallbackState.mockResolvedValue({ applied: true });
    mocks.updateProviderConnection.mockImplementation(async (id, updates) => ({ id, ...updates }));
    mocks.getProviderConnections.mockImplementation(async ({ provider } = {}) =>
      mocks.connections.filter((connection) => !provider || connection.provider === provider));
  });

  afterEach(async () => {
    while (nodes.length) await nodes.pop().close();
  });

  async function node(options) {
    const started = await startOpenAiNode(options);
    nodes.push(started);
    return started;
  }

  it("serves the request from the healthy node when the first one is down", async () => {
    const down = await node({});
    await down.close();
    nodes.pop();
    const healthy = await node({ content: "served by the second node" });

    mocks.nodes = [
      { id: "openai-compatible-down", type: "openai-compatible", prefix: "down", apiType: "chat-completions", baseUrl: down.baseUrl },
      { id: "openai-compatible-up", type: "openai-compatible", prefix: "up", apiType: "chat-completions", baseUrl: healthy.baseUrl },
    ];
    mocks.connections = [
      compatibleConnection("conn-down", "openai-compatible-down", down.baseUrl, 1),
      compatibleConnection("conn-up", "openai-compatible-up", healthy.baseUrl, 2),
    ];
    mocks.combos = [{
      name: "node-combo",
      models: ["down/model-x", "up/model-x"],
      members: ["down/model-x", "up/model-x"],
    }];

    const response = await callChat("node-combo");

    expect(response.status).toBe(200);
    expect(healthy.chatRequests()).toBe(1);
    // The down node was tried first and its failure was recorded against it.
    expect(mocks.recordProviderConnectionFallbackState.mock.calls.map((call) => call[0]))
      .toContain("conn-down");
    const payload = await response.json();
    expect(payload.choices?.[0]?.message?.content).toContain("served by the second node");
  });

  it("fails over when the first node answers with a server error", async () => {
    const broken = await node({ content: "never used", status: 500 });
    const healthy = await node({ content: "served after the broken node" });

    mocks.nodes = [
      { id: "openai-compatible-broken", type: "openai-compatible", prefix: "broken", apiType: "chat-completions", baseUrl: broken.baseUrl },
      { id: "openai-compatible-healthy", type: "openai-compatible", prefix: "healthy", apiType: "chat-completions", baseUrl: healthy.baseUrl },
    ];
    mocks.connections = [
      compatibleConnection("conn-broken", "openai-compatible-broken", broken.baseUrl, 1),
      compatibleConnection("conn-healthy", "openai-compatible-healthy", healthy.baseUrl, 2),
    ];
    mocks.combos = [{
      name: "node-combo",
      models: ["broken/model-x", "healthy/model-x"],
      members: ["broken/model-x", "healthy/model-x"],
    }];
    // The first node answers 500: a retryable server failure.

    const response = await callChat("node-combo");

    expect(response.status).toBe(200);
    expect(broken.chatRequests()).toBe(1);
    expect(healthy.chatRequests()).toBe(1);
    const payload = await response.json();
    expect(payload.choices?.[0]?.message?.content).toContain("served after the broken node");
  });

  it("keeps both nodes as separate providers", async () => {
    const first = await node({ content: "first node" });
    const second = await node({ content: "second node" });

    mocks.nodes = [
      { id: "openai-compatible-first", type: "openai-compatible", prefix: "first", apiType: "chat-completions", baseUrl: first.baseUrl },
      { id: "openai-compatible-second", type: "openai-compatible", prefix: "second", apiType: "chat-completions", baseUrl: second.baseUrl },
    ];
    mocks.connections = [
      compatibleConnection("conn-first", "openai-compatible-first", first.baseUrl, 1),
      compatibleConnection("conn-second", "openai-compatible-second", second.baseUrl, 2),
    ];
    mocks.combos = [{
      name: "node-combo",
      models: ["first/model-x", "second/model-x"],
      members: ["first/model-x", "second/model-x"],
    }];

    const response = await callChat("node-combo");

    expect(response.status).toBe(200);
    // Each node keeps its own provider row, so the combo can address both.
    expect(mocks.connections.map((connection) => connection.provider))
      .toEqual(["openai-compatible-first", "openai-compatible-second"]);
    expect(first.chatRequests()).toBe(1);
  });
});
