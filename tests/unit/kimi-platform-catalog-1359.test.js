import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getModelLifecycleDecision } from "../../open-sse/services/modelLifecycle.js";
import { LLM_KIND, buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  getSyncedModelCatalogs: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getSyncedModelCatalogs: mocks.getSyncedModelCatalogs,
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));

const KIMI_PLATFORM_IDS = [
  "kimi-k3.1-pro",
  "kimi-k3.1-pro-highspeed",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.7-code-highspeed",
  "kimi-k2.6",
];

describe("Kimi Platform catalog (#1359)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([{
      id: "kimi-key",
      provider: "kimi",
      authType: "apikey",
      apiKey: "sk-test",
      isActive: true,
      providerSpecificData: {},
    }]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue([]);
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
    mocks.getSyncedModelCatalogs.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("lists exactly the official Platform IDs on the kimi registry", () => {
    expect(PROVIDER_MODELS.kimi.map((model) => model.id)).toEqual(KIMI_PLATFORM_IDS);
  });

  it("exposes the new IDs through /v1/models with sourced capabilities", async () => {
    const models = await buildModelsList([LLM_KIND]);
    const byId = Object.fromEntries(models.map((model) => [model.id, model]));

    expect(byId["kimi/kimi-k3.1-pro"]).toMatchObject({
      id: "kimi/kimi-k3.1-pro",
      owned_by: "kimi",
      name: "Kimi K3.1 Pro",
      context_length: 1048576,
      max_completion_tokens: 1048576,
      capabilities: {
        vision: true,
        videoInput: true,
        reasoning: true,
        structuredOutput: true,
        promptCaching: true,
        thinkingFormat: "kimi",
        thinkingCanDisable: false,
        thinkingEfforts: ["low", "high", "max"],
        contextWindow: 1048576,
        maxOutput: 1048576,
        defaultOutput: 131072,
      },
    });
    expect(byId["kimi/kimi-k3.1-pro-highspeed"]).toMatchObject({
      context_length: 1048576,
      max_completion_tokens: 1048576,
      capabilities: {
        vision: true,
        reasoning: true,
        thinkingEfforts: ["low", "high", "max"],
        contextWindow: 1048576,
        maxOutput: 1048576,
      },
    });
    expect(byId["kimi/kimi-k2.7-code"]).toMatchObject({
      context_length: 262144,
      capabilities: {
        vision: true,
        videoInput: true,
        reasoning: true,
        thinkingCanDisable: false,
        contextWindow: 262144,
        maxOutput: null,
        defaultOutput: 32768,
      },
    });
    expect(byId["kimi/kimi-k2.7-code"].max_completion_tokens).toBeUndefined();
    expect(byId["kimi/kimi-k2.6"]).toMatchObject({
      context_length: 262144,
      capabilities: {
        vision: true,
        videoInput: true,
        reasoning: true,
        thinkingCanDisable: true,
        contextWindow: 262144,
        maxOutput: null,
      },
    });
    expect(byId["kimi/kimi-k2.6"].max_completion_tokens).toBeUndefined();
  });

  it("keeps allowlisted capability lookups exact and leaves unknown ids on the family floor", () => {
    expect(getCapabilitiesForModel("kimi", "kimi-k3.1-pro")).toEqual({
      vision: true,
      pdf: false,
      audioInput: false,
      videoInput: true,
      imageOutput: false,
      audioOutput: false,
      videoOutput: false,
      structuredOutput: true,
      promptCaching: true,
      search: false,
      tools: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      thinkingEfforts: ["low", "high", "max"],
      thinkingType: null,
      thinkingModes: null,
      supportedTools: null,
      thinkingRange: null,
      contextWindow: 1048576,
      maxOutput: 1048576,
      defaultOutput: 131072,
    });
    expect(resolveModelLimits("kimi", "kimi-k3.1-pro")).toEqual({
      contextWindow: 1048576,
      maxOutput: 1048576,
      known: true,
      source: "provider",
    });
    expect(getThinkingLevels("kimi", "kimi-k3.1-pro")).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("kimi", "kimi-k2.6")).toEqual(["none", "low", "medium", "high", "max"]);
    expect(getThinkingLevels("kimi", "kimi-k2.7-code")).toEqual(["low", "medium", "high", "max"]);

    // Unknown Platform-shaped ids keep the pre-existing *kimi* family floor — no K3.1 Pro fields.
    expect(getCapabilitiesForModel("kimi", "kimi-k9-unknown")).toEqual({
      vision: false,
      pdf: false,
      audioInput: false,
      videoInput: false,
      imageOutput: false,
      audioOutput: false,
      videoOutput: false,
      structuredOutput: false,
      promptCaching: false,
      search: false,
      tools: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: true,
      thinkingEfforts: null,
      thinkingType: null,
      thinkingModes: null,
      supportedTools: null,
      thinkingRange: null,
      contextWindow: 262144,
      maxOutput: null,
    });
  });

  it("flags only the K2 series through the lifecycle policy", () => {
    const asOf = new Date("2026-10-29T00:00:00.000Z");
    expect(getModelLifecycleDecision("kimi", "kimi-k2.6", asOf).status).toBe("deprecated");
    expect(getModelLifecycleDecision("kimi", "kimi-k3.1-pro", asOf).status).toBe("untracked");
    expect(getModelLifecycleDecision("kimi", "kimi-k9-unknown", asOf).status).toBe("untracked");
  });
});
