import { afterEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(), getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []), getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({ modelAutoSyncProviders: { tokenharbor: true } })) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

afterEach(() => vi.unstubAllGlobals());

it("lists only the selected connection's live Token Harbor catalog", async () => {
  db.getProviderConnections.mockResolvedValue([
    { id: "first", provider: "tokenharbor", apiKey: "first-key", isActive: true },
    { id: "second", provider: "tokenharbor", apiKey: "second-key", isActive: true },
  ]);
  const fetchMock = vi.fn(async (url, init) => {
    if (url !== "https://tokenharbor.ai/v1/models") throw new Error(`Unexpected network request: ${url}`);
    expect(init.headers.Authorization).toBe("Bearer first-key");
    return Response.json({ data: [{ id: "vendor/exact:free" }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const ids = (await buildModelsList(["llm"])).map((model) => model.id);
  expect(ids).toContain("tokenharbor/vendor/exact:free");
  expect(fetchMock.mock.calls.filter(([url]) => url === "https://tokenharbor.ai/v1/models")).toHaveLength(1);
});
