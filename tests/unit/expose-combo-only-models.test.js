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

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: mocks.getSettings,
}));

async function buildModelsList(kinds) {
  const module = await import("../../src/app/api/v1/models/buildModelsList.js");
  return module.buildModelsList(kinds);
}

describe("buildModelsList exposeComboOnly", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([
      { id: "direct-model", providerAlias: "openai", type: "llm" },
    ]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getCombos.mockResolvedValue([
      { name: "chat-pool", kind: "llm", models: ["openai/direct-model"] },
      { name: "search-pool", kind: "webSearch", models: ["exa/search"] },
      { name: "search-pool", kind: "webSearch", models: ["tavily/search"] },
      { name: "fetch-pool", kind: "webFetch", models: ["exa/fetch"] },
      { name: "image-pool", kind: "image", models: ["openai/image"] },
    ]);
  });

  it("toggle on returns only deduplicated matching combos and preserves web kinds", async () => {
    mocks.getSettings.mockResolvedValue({ exposeComboOnly: true });

    const models = await buildModelsList(["llm", "webSearch", "webFetch"]);

    expect(models).toEqual([
      { id: "chat-pool", object: "model", owned_by: "combo" },
      { id: "search-pool", object: "model", owned_by: "combo", kind: "webSearch" },
      { id: "fetch-pool", object: "model", owned_by: "combo", kind: "webFetch" },
    ]);
    expect(mocks.getCustomModels).not.toHaveBeenCalled();
    expect(mocks.getModelAliases).not.toHaveBeenCalled();
    expect(mocks.getDisabledModels).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "hidePaidModels with exposeComboOnly=%s keeps unknown nested members but excludes cycles and all-paid pools",
    async (exposeComboOnly) => {
      mocks.getSettings.mockResolvedValue({ exposeComboOnly, hidePaidModels: true });
      mocks.getCombos.mockResolvedValue([
        { name: "all-paid", kind: "llm", models: ["anthropic/claude-sonnet-5"] },
        { name: "free-pool", kind: "llm", models: ["aug/claude-sonnet-4.6"] },
        { name: "mixed-pool", kind: "llm", models: ["anthropic/claude-sonnet-5", "aug/claude-sonnet-4.6"] },
        { name: "nested-safe", kind: "llm", models: ["all-paid", "free-pool"] },
        { name: "nested-paid", kind: "llm", models: ["all-paid"] },
        { name: "deleted-nested", kind: "llm", models: ["deleted-pool"] },
        { name: "legacy-member", kind: "llm", models: [{ deleted: true }] },
        { name: "unavailable-cycle", kind: "llm", models: ["unavailable-cycle"] },
      ]);

      const models = await buildModelsList(["llm"]);
      const comboIds = models.filter((model) => model.owned_by === "combo").map((model) => model.id);

      expect(comboIds).toEqual(["free-pool", "mixed-pool", "nested-safe", "deleted-nested", "legacy-member"]);
    },
  );

  it("settings read failure keeps the normal direct and paid catalog", async () => {
    mocks.getSettings.mockRejectedValue(new Error("settings unavailable"));
    mocks.getCombos.mockResolvedValue([
      { name: "all-paid", kind: "llm", models: ["anthropic/claude-sonnet-5"] },
    ]);

    const models = await buildModelsList(["llm"]);

    expect(models).not.toHaveLength(0);
    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining(["all-paid", "openai/direct-model"]));
  });

  it("toggle off keeps direct models in the catalog", async () => {
    mocks.getSettings.mockResolvedValue({ exposeComboOnly: false });

    const models = await buildModelsList(["llm"]);

    expect(models.map((model) => model.id)).toContain("openai/direct-model");
  });
});
