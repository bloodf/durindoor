import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  connections: vi.fn(),
  combos: vi.fn(),
  custom: vi.fn(),
  settings: vi.fn(),
  live: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: fixtures.connections,
  getCombos: fixtures.combos,
  getCustomModels: fixtures.custom,
  getModelAliases: async () => ({}),
  getSyncedModelCatalogs: async () => ({}),
  getProviderNodes: async () => [],
}));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: fixtures.settings }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: async () => ({}) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: async () => null }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/shared/constants/models", async (importOriginal) => ({
  ...await importOriginal(),
  PROVIDER_ID_TO_ALIAS: { fixture: "fixture", keyless: "keyless" },
  PROVIDER_MODELS: {
    fixture: [{ id: "picture", kind: "image" }, { id: "chat", kind: "llm" }],
    keyless: [],
  },
}));
vi.mock("@/shared/constants/providers", async (importOriginal) => ({
  ...await importOriginal(),
  AI_PROVIDERS: {
    fixture: { serviceKinds: ["llm", "image", "imageToText"] },
    keyless: { noAuth: true, serviceKinds: ["image"], modelsFetcher: { type: "openai", url: "https://fixture.invalid/models" } },
  },
  getProviderAlias: (id) => id,
}));
vi.mock("open-sse/config/providers.js", async (importOriginal) => ({
  ...await importOriginal(),
  PROVIDERS: { keyless: { headers: { Authorization: "Bearer inert-fixture" } } },
}));
vi.mock("open-sse/services/liveModelLimits.js", async (importOriginal) => ({
  ...await importOriginal(),
  resolveLiveOpenAIModels: fixtures.live,
}));

import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";
import { buildModelsResponse } from "../../src/app/api/v1/models/_shared.js";

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.connections.mockResolvedValue([{ id: "fixture", provider: "fixture", isActive: true, apiKey: "inert-fixture" }]);
  fixtures.combos.mockResolvedValue([]);
  fixtures.custom.mockResolvedValue([]);
  fixtures.settings.mockResolvedValue({});
  fixtures.live.mockResolvedValue({ models: [] });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => vi.unstubAllGlobals());

async function discover(kinds, path = "") {
  const models = await buildModelsList(kinds);
  const response = buildModelsResponse(new Request(`http://localhost/v1/models${path}`), models);
  expect(response.status).toBe(200);
  return { models, data: (await response.json()).data };
}

describe("resolved discovery kind projection", () => {
  it("retains permitted custom imageToText in root discovery with exact IDs", async () => {
    fixtures.custom.mockResolvedValue([{ id: "vision", providerAlias: "fixture", kind: "imageToText" }]);
    const { models, data } = await discover(["llm"]);
    expect(models.map((row) => row.id)).toEqual(["fixture/chat", "fixture/vision"]);
    expect(models.find((row) => row.id === "fixture/vision")).toMatchObject({ kind: "imageToText" });
    expect(data.find((row) => row.id === "fixture/vision")).toMatchObject({ id: "fixture/vision", kind: "imageToText" });
    expect(data.map((row) => row.id)).toEqual(["fixture/chat", "fixture/vision"]);
  });

  it.each(["connected", "static fallback"])("retains media kind through %s builder and ordinary HTTP projection", async (branch) => {
    if (branch === "static fallback") fixtures.connections.mockRejectedValue(new Error("inert unavailable DB fixture"));
    const { models, data } = await discover(["image"], "/image");
    expect(models.map((row) => row.id)).toEqual(["fixture/picture"]);
    expect(models[0]).toMatchObject({ id: "fixture/picture", kind: "image" });
    expect(data).toEqual([expect.objectContaining({ id: "fixture/picture", kind: "image" })]);
    const llm = await discover(["llm"]);
    expect(llm.models.map((row) => row.id)).toEqual(["fixture/chat"]);
    expect(llm.data.map((row) => row.id)).toEqual(["fixture/chat"]);
  });

  it("retains the resolved kind from an inert no-auth live catalog", async () => {
    fixtures.connections.mockResolvedValue([]);
    fixtures.live.mockResolvedValue({ models: [{ id: "live-picture", kind: "image" }] });
    const { models, data } = await discover(["image"], "/image");
    expect(fixtures.live).toHaveBeenCalledOnce();
    expect(models).toEqual([expect.objectContaining({ id: "keyless/live-picture", kind: "image" })]);
    expect(data).toEqual([expect.objectContaining({ id: "keyless/live-picture", kind: "image" })]);
  });

  it.each([false, true])("retains combo media kind with exposeComboOnly=%s", async (exposeComboOnly) => {
    fixtures.connections.mockResolvedValue([]);
    fixtures.settings.mockResolvedValue({ exposeComboOnly });
    fixtures.combos.mockResolvedValue([{ name: "pictures", kind: "image", models: ["fixture/picture"] }]);
    const { models, data } = await discover(["image"], "/image");
    expect(models).toEqual([expect.objectContaining({ id: "pictures", kind: "image", owned_by: "combo" })]);
    expect(data).toEqual([expect.objectContaining({ id: "pictures", kind: "image", owned_by: "combo" })]);
    expect((await discover(["llm"])).models).toEqual([]);
  });
});
