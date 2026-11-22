import { beforeEach, describe, expect, it, vi } from "vitest";

// Upstream decolua/9router #3880 (#3115): a curated custom-model list on a
// compatible node wins over the provider's live /models catalog.

const { connectionsMock, customModelsMock, fetchMock } = vi.hoisted(() => ({
  connectionsMock: vi.fn(),
  customModelsMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: connectionsMock,
  getCombos: vi.fn(async () => []),
  getCustomModels: customModelsMock,
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(() => null) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");

const PROVIDER_ID = "openai-compatible-chat-3880aaaa";
const UPSTREAM = ["keep-me", "drop-me-1", "drop-me-2"];
let n = 0;
let base;

const idsFor = (models) => models.filter((m) => m.id.startsWith("hn/")).map((m) => m.id.slice(3)).sort();
const compatibleCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(base));

beforeEach(() => {
  vi.clearAllMocks();
  // The compatible catalog cache is keyed on the base URL: use a fresh one per test.
  base = `https://catalog-${++n}.example.com/v1`;
  global.fetch = fetchMock;
  connectionsMock.mockResolvedValue([{
    id: `conn-${n}`,
    provider: PROVIDER_ID,
    isActive: true,
    apiKey: "sk-test",
    providerSpecificData: { prefix: "hn", apiType: "chat", baseUrl: base },
  }]);
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ data: UPSTREAM.map((id) => ({ id })) }),
  }));
});

describe("#3115 curated compatible-node model list wins over live catalog", () => {
  it("lists only the curated models and skips the upstream /models call", async () => {
    customModelsMock.mockResolvedValue([{ providerAlias: "hn", id: "keep-me", type: "llm" }]);
    const data = await buildModelsList(["llm"]);
    expect(idsFor(data)).toEqual(["keep-me"]);
    expect(compatibleCalls()).toHaveLength(0);
  });

  it("falls back to the live catalog when nothing is curated", async () => {
    customModelsMock.mockResolvedValue([]);
    const data = await buildModelsList(["llm"]);
    expect(idsFor(data)).toEqual([...UPSTREAM].sort());
    expect(compatibleCalls().length).toBeGreaterThan(0);
  });

  it("ignores curated models that belong to another provider", async () => {
    customModelsMock.mockResolvedValue([{ providerAlias: "other", id: "not-mine", type: "llm" }]);
    const data = await buildModelsList(["llm"]);
    expect(idsFor(data)).toEqual([...UPSTREAM].sort());
  });
});
