import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disabled: vi.fn(), aliases: vi.fn(), nodes: vi.fn(), combo: vi.fn(), connections: vi.fn(), key: vi.fn(), route: vi.fn(), auth: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.disabled }));
vi.mock("@/lib/localDb", () => ({
  getModelAliases: mocks.aliases, getProviderNodes: mocks.nodes,
  getComboForModel: mocks.combo, getComboByName: mocks.combo,
  getProviderConnections: mocks.connections, getSettings: vi.fn(async () => ({})),
  getCombos: vi.fn(async () => [{ name: "web", models: ["tavily", "firecrawl"] }]), getApiKeyByKey: mocks.key,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: mocks.auth, getNoAuthProviderCredentials: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(), markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(), projectProviderCredentials: vi.fn(),
}));
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrlResolved: vi.fn() }));
vi.mock("open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
vi.mock("open-sse/services/combo.js", async (original) => ({
  ...(await original()), handleComboChat: mocks.route,
}));
const { filterDisabledComboModels, getComboModels } = await import("../../src/sse/services/model.js");

beforeEach(() => {
  mocks.disabled.mockResolvedValue({});
  mocks.aliases.mockResolvedValue({});
  mocks.nodes.mockResolvedValue([]);
  mocks.combo.mockResolvedValue(null);
  mocks.connections.mockResolvedValue([]);
  mocks.auth.mockResolvedValue({ apiKey: null, auth: { ok: true } });
  mocks.key.mockResolvedValue(null);
  mocks.route.mockImplementation(async ({ models }) => Response.json({ models }, { status: models.length ? 200 : 503 }));
});

describe("disabled combo members", () => {
  it("filters aliases and provider-only members by endpoint, preserving unrelated models", async () => {
    mocks.aliases.mockResolvedValue({ shortcut: "tavily/search" });
    mocks.disabled.mockResolvedValue({ tavily: ["search"], firecrawl: ["fetch"] });
    expect(await filterDisabledComboModels(["shortcut", "tavily", "firecrawl", "tavily/other"], "search"))
      .toEqual(["firecrawl", "tavily/other"]);
    expect(await filterDisabledComboModels(["tavily", "firecrawl"], "fetch")).toEqual(["tavily"]);
    expect(await filterDisabledComboModels(["tavily"], "search")).toEqual([]);
    expect(await filterDisabledComboModels(null, "search")).toBeNull();
  });

  it("filters saved and auto combo members using provider aliases", async () => {
    mocks.disabled.mockResolvedValue({ mimocode: ["mimo-auto"] });
    mocks.combo.mockResolvedValue({ models: ["mcode/mimo-auto", "openai/other"] });
    expect(await getComboModels("saved")).toEqual(["openai/other"]);
    expect(await getComboModels("auto/mimo")).not.toContain("mcode/mimo-auto");
    mocks.disabled.mockResolvedValue({});
    expect(await getComboModels("auto/mimo")).toContain("mcode/mimo-auto");
  });
});

for (const endpoint of ["search", "fetch"]) {
  it(`${endpoint} filters combo members after ACL checks`, async () => {
    const handler = endpoint === "search"
      ? (await import("../../src/sse/handlers/search.js")).handleSearch
      : (await import("../../src/sse/handlers/fetch.js")).handleFetch;
    const request = () => new Request(`http://localhost/v1/${endpoint}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "web", query: "test", url: "https://example.com" }),
    });
    mocks.combo.mockResolvedValue({ name: "web", models: ["tavily", "firecrawl"] });
    mocks.disabled.mockResolvedValue({ tavily: [endpoint] });
    expect((await (await handler(request())).json()).models).toEqual(["firecrawl"]);
    mocks.disabled.mockResolvedValue({ tavily: [endpoint], firecrawl: [endpoint] });
    expect((await handler(request())).status).toBe(503);
    mocks.auth.mockResolvedValue({ apiKey: "key", auth: { ok: true } });
    mocks.key.mockResolvedValue({ name: "key", allowedCombos: ["other"] });
    expect((await handler(request())).status).toBe(403);
  });
}
