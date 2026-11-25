import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

// #2023: keyless LAN connections on compatible nodes are accepted, and their
// validation probes and upstream requests carry no auth header.
const nodes = vi.hoisted(() => new Map());
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(async () => [...nodes.values()]),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(async (id) => nodes.get(id) || null),
  createProviderConnection: vi.fn(async (data) => ({ id: "lan-conn", ...data })),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));

const { POST: createProvider } = await import("@/app/api/providers/route.js");
const { POST: validateProvider } = await import("@/app/api/providers/validate/route.js");
const { DefaultExecutor } = await import("open-sse/executors/default.js");
const models = await import("@/lib/localDb");

let server;
let baseUrl;
const requests = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "lan-model" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  for (const [id, type] of [
    ["openai-compatible-chat-lan", "openai-compatible"],
    ["anthropic-compatible-lan", "anthropic-compatible"],
    ["custom-embedding-lan", "custom-embedding"],
  ]) nodes.set(id, { id, type, name: id, prefix: id, baseUrl, apiType: "chat" });
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  requests.length = 0;
  vi.clearAllMocks();
});

const post = (url, body) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const providers = ["openai-compatible-chat-lan", "anthropic-compatible-lan", "custom-embedding-lan"];

describe("keyless LAN compatible connections", () => {
  it.each(providers)("creates %s without an API key", async (provider) => {
    const res = await createProvider(post("http://localhost/api/providers", {
      provider, name: "lan", providerSpecificData: { baseUrl },
    }));
    expect(res.status).toBe(201);
    expect(models.createProviderConnection).toHaveBeenCalledOnce();
  });

  it("still requires a key for a keyed registry provider", async () => {
    const res = await createProvider(post("http://localhost/api/providers", { provider: "openai", name: "x" }));
    expect(res.status).toBe(400);
    expect(models.createProviderConnection).not.toHaveBeenCalled();
  });

  it.each(providers)("validates %s against a mock server with no auth headers", async (provider) => {
    const res = await validateProvider(post("http://localhost/api/providers/validate", { provider }));
    expect((await res.json()).valid).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers["x-api-key"]).toBeUndefined();
    }
  });

  it.each([
    ["openai-compatible-chat-lan", "authorization", "Bearer lan-secret"],
    ["anthropic-compatible-lan", "x-api-key", "lan-secret"],
  ])("keeps sending the key when %s has one", async (provider, header, value) => {
    const res = await validateProvider(post("http://localhost/api/providers/validate", { provider, apiKey: "lan-secret" }));
    expect((await res.json()).valid).toBe(true);
    expect(requests.at(-1).headers[header]).toBe(value);
  });

  it.each(["openai-compatible-chat-lan", "anthropic-compatible-lan"])(
    "sends %s upstream requests without auth headers when no key is set",
    (provider) => {
      const headers = new DefaultExecutor(provider).buildHeaders({ apiKey: "", providerSpecificData: { baseUrl } }, false);
      expect(headers).not.toHaveProperty("Authorization");
      expect(headers).not.toHaveProperty("x-api-key");
      const keyed = new DefaultExecutor(provider).buildHeaders({ apiKey: "lan-secret", providerSpecificData: { baseUrl } }, false);
      expect(keyed.Authorization || keyed["x-api-key"]).toMatch(/lan-secret/);
    },
  );
});
