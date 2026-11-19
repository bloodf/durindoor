import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

/**
 * #2024 — route by model across several Ollama nodes.
 *
 * Each node is a real in-process HTTP server that answers the Ollama catalog
 * endpoints (`/api/tags`, `/api/ps`, `/api/show`) with its own model list, so
 * the routing decision is made against discovered catalogs and not fixtures.
 */

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: vi.fn(async () => null),
  getApiKeyByKey: vi.fn(async () => null),
  validateApiKey: vi.fn(async () => true),
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(async () => []),
  getQuotaReservationPressure: mocks.getQuotaReservationPressure,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  listProviderQuotaSnapshots: vi.fn(async () => []),
  getQuotaFetchState: vi.fn(async () => null),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

/** Start an in-process Ollama node that serves `models` from /api/tags. */
async function startOllamaNode({ models = [], chatStatus = 200 } = {}) {
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
      res.writeHead(chatStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true }));
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

describe("ollama-local routing by model across several nodes (#2024)", () => {
  const nodes = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });
    mocks.getQuotaReservationPressure.mockResolvedValue(new Map());
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
    mocks.updateProviderConnection.mockImplementation(async (id, updates) => ({ id, ...updates }));
  });

  afterEach(async () => {
    while (nodes.length) await nodes.pop().close();
  });

  async function node(options) {
    const started = await startOllamaNode(options);
    nodes.push(started);
    return started;
  }

  it("routes a model only to the nodes whose catalog lists it", async () => {
    const alpha = await node({ models: ["alpha:1b"] });
    const beta = await node({ models: ["beta:1b"] });
    const both = await node({ models: ["alpha:1b", "beta:1b"] });
    mocks.getProviderConnections.mockResolvedValue([
      ollamaConnection("conn-alpha", alpha.host, 1),
      ollamaConnection("conn-beta", beta.host, 2),
      ollamaConnection("conn-both", both.host, 3),
    ]);

    const credentials = await getProviderCredentials("ollama-local", null, "beta:1b");

    expect(credentials?.connectionId).toBe("conn-beta");
    // The node that does not serve the model is never asked for it.
    expect(alpha.requests).not.toContain("/api/chat");
    expect(both.requests).not.toContain("/api/chat");
  });

  it("matches a model served without an explicit tag", async () => {
    const tagged = await node({ models: ["llama3.2:latest"] });
    const other = await node({ models: ["qwen3:8b"] });
    mocks.getProviderConnections.mockResolvedValue([
      ollamaConnection("conn-tagged", tagged.host, 1),
      ollamaConnection("conn-other", other.host, 2),
    ]);

    const credentials = await getProviderCredentials("ollama-local", null, "llama3.2");

    expect(credentials?.connectionId).toBe("conn-tagged");
  });

  it("keeps a node with an unknown catalog eligible, behind the confirmed ones", async () => {
    const serving = await node({ models: ["beta:1b"] });
    // A node that is down cannot answer /api/tags: its list stays unknown.
    const unreachable = await node({ models: [] });
    await unreachable.close();
    nodes.pop();
    mocks.getProviderConnections.mockResolvedValue([
      ollamaConnection("conn-unknown", unreachable.host, 1),
      ollamaConnection("conn-serving", serving.host, 2),
    ]);

    const credentials = await getProviderCredentials("ollama-local", null, "beta:1b");

    expect(credentials?.connectionId).toBe("conn-serving");
  });

  it("keeps today's behaviour when no node lists the model", async () => {
    const alpha = await node({ models: ["alpha:1b"] });
    const beta = await node({ models: ["beta:1b"] });
    mocks.getProviderConnections.mockResolvedValue([
      ollamaConnection("conn-alpha", alpha.host, 1),
      ollamaConnection("conn-beta", beta.host, 2),
    ]);

    const credentials = await getProviderCredentials("ollama-local", null, "gamma:1b");

    // Nothing confirms the model, so the established fill-first order stands.
    expect(credentials?.connectionId).toBe("conn-alpha");
  });

  it("serves a model from the node that lists it even when another node is ranked first", async () => {
    const unreachable = await node({ models: [] });
    await unreachable.close();
    nodes.pop();
    const serving = await node({ models: ["beta:1b"] });
    mocks.getProviderConnections.mockResolvedValue([
      ollamaConnection("conn-unknown", unreachable.host, 1),
      ollamaConnection("conn-serving", serving.host, 2),
    ]);

    const credentials = await getProviderCredentials("ollama-local", null, "beta:1b");

    expect(credentials?.connectionId).toBe("conn-serving");
  });
});
