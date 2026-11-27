import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getSyncedModelCatalogs: vi.fn(),
  getProviderNodes: vi.fn(),
  getDisabledModels: vi.fn(),
  getEnabledModels: vi.fn(),
  getSettings: vi.fn(),
  getSharedModelMetadata: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSyncedModelCatalogs: mocks.getSyncedModelCatalogs,
  getProviderNodes: mocks.getProviderNodes,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: mocks.getEnabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: mocks.getSharedModelMetadata }));

const { getCapabilitiesForModel, resolveModelLimits } = await import("../../open-sse/providers/capabilities.js");
const { buildModelsList } = await import("@/shared/models/buildModelsList.js");

describe("Custom gateway hyphenated GLM limits (upstream PR #5895)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getSyncedModelCatalogs.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getEnabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
    mocks.getSharedModelMetadata.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes hyphenated GLM version IDs in capabilities and static limits", () => {
    expect(getCapabilitiesForModel("kenari", "glm-5-3-flash")).toMatchObject({
      vision: true,
      videoInput: true,
      pdf: true,
      reasoning: true,
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(resolveModelLimits("kenari", "glm-5-3-flash")).toMatchObject({
      known: true,
      source: "exact",
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(resolveModelLimits("kenari", "glm-5-2")).toMatchObject({
      known: true,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(resolveModelLimits("kenari", "glm-4-7")).toMatchObject({
      known: true,
      contextWindow: 200000,
      maxOutput: 131072,
    });
    expect(resolveModelLimits("kenari", "glm-4-32b-0414-128k")).toMatchObject({
      known: true,
      contextWindow: 131072,
    });
    expect(resolveModelLimits("kenari", "glm-5-turbo")).toMatchObject({
      known: true,
      contextWindow: 200000,
      maxOutput: 131072,
    });
  });

  it("publishes exact limits for hyphenated GLM models on compatible custom connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-kenari",
        provider: "openai-compatible-custom-node",
        isActive: true,
        providerSpecificData: {
          prefix: "kenari",
          baseUrl: "https://api.kenari.example/v1",
          enabledModels: ["glm-5-3-flash"],
        },
      },
    ]);

    const models = await buildModelsList(["llm"]);
    const entry = models.find((model) => model.id === "kenari/glm-5-3-flash");
    expect(entry).toMatchObject({
      id: "kenari/glm-5-3-flash",
      context_length: 1000000,
      max_completion_tokens: 131072,
      capabilities: expect.objectContaining({
        vision: true,
        contextWindow: 1000000,
        maxOutput: 131072,
      }),
    });
  });
});
