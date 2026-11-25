import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Upstream decolua/9router #4954: the models an operator configured on a
// compatible node are its public catalog, whatever upstream discovery returns.

const { connectionsMock, customModelsMock, enabledMock, fetchMock } = vi.hoisted(() => ({
  connectionsMock: vi.fn(),
  customModelsMock: vi.fn(),
  enabledMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: connectionsMock,
  getCombos: vi.fn(async () => []),
  getCustomModels: customModelsMock,
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: enabledMock }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");

const PROVIDER_ID = "openai-compatible-chat-4954aaaa";
const originalFetch = global.fetch;
let n = 0;
let upstream = [];

function stubNode(providerSpecificData = {}) {
  n += 1;
  connectionsMock.mockResolvedValue([{
    id: `conn-4954-${n}`,
    provider: PROVIDER_ID,
    isActive: true,
    apiKey: "sk-test",
    // The compatible catalog cache is keyed on the base URL: use a fresh one per test.
    providerSpecificData: { prefix: "cur", apiType: "chat", baseUrl: `https://catalog-4954-${n}.example.com/v1`, ...providerSpecificData },
  }]);
}

async function nodeModels() {
  return (await buildModelsList(["llm"])).filter((model) => model.id.startsWith("cur/"));
}
const nodeIds = async () => (await nodeModels()).map((model) => model.id).sort();

beforeEach(() => {
  vi.clearAllMocks();
  upstream = [];
  customModelsMock.mockResolvedValue([]);
  enabledMock.mockResolvedValue({});
  global.fetch = fetchMock;
  fetchMock.mockImplementation(async () => Response.json({ data: upstream }));
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("port decolua/9router #4954 — configured compatible-node catalog", () => {
  it("lists a per-connection model list when discovery is empty", async () => {
    stubNode({ enabledModels: ["explicit"] });
    expect(await nodeIds()).toEqual(["cur/explicit"]);
  });

  it("lists the provider allowlist when discovery fails", async () => {
    stubNode();
    enabledMock.mockResolvedValue({ [PROVIDER_ID]: ["picked"] });
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    expect(await nodeIds()).toEqual(["cur/picked"]);
  });

  it("does not expand an allowlisted node to the upstream catalog, but keeps live limits", async () => {
    stubNode();
    enabledMock.mockResolvedValue({ [PROVIDER_ID]: ["picked"] });
    upstream = [{ id: "picked", context_length: 77_000 }, { id: "unrequested" }];
    const models = await nodeModels();
    expect(models.map((model) => model.id)).toEqual(["cur/picked"]);
    expect(models[0].context_length).toBe(77_000);
  });

  it("keeps saved custom models authoritative over a stale per-connection list", async () => {
    stubNode({ enabledModels: ["stale"] });
    customModelsMock.mockResolvedValue([{ providerAlias: "cur", id: "chosen", type: "llm" }]);
    expect(await nodeIds()).toEqual(["cur/chosen"]);
  });

  it("still discovers an unconfigured node", async () => {
    stubNode();
    upstream = [{ id: "upstream-live" }];
    expect(await nodeIds()).toEqual(["cur/upstream-live"]);
  });
});
