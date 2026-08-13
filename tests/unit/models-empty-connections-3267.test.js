import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));

describe("buildModelsList DB availability (#3267)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({ disabledFreeProviders: [], hidePaidModels: false });
  });

  it("omits connection-backed built-ins when the DB is healthy with no connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "custom", id: "explicit-model", type: "llm" },
    ]);
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const ids = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(ids).toContain("custom/explicit-model");
    expect(ids).not.toContain("anthropic/claude-sonnet-4-20250514");
  });

  it("falls back to the built-in catalog when the DB is unavailable", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("DB unavailable"));
    const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
    const ids = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(ids).toContain("anthropic/claude-sonnet-4-20250514");
  });
});
