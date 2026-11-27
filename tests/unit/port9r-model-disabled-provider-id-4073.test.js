import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [],
  customModels: [],
  disabledModels: {},
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => mocks.connections),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => mocks.customModels),
  getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalogs: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => mocks.disabledModels) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/services/usage/codex.js", () => ({ getCodexModels: vi.fn(async () => null) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/modelAutoSync/sharedMetadata.js", () => ({ getSharedModelMetadata: vi.fn(async () => null) }));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

describe("9router #4073 disabled-model lookup across providerId and aliases", () => {
  beforeEach(() => {
    mocks.connections = [];
    mocks.customModels = [];
    mocks.disabledModels = {};
  });

  it("hides a built-in provider model disabled under its providerId", async () => {
    mocks.connections = [{ id: "codex-1", provider: "codex", isActive: true, accessToken: "tok" }];
    mocks.disabledModels = { codex: ["gpt-5.4"] };

    const ids = (await buildModelsList([LLM_KIND])).map((model) => model.id);
    expect(ids).not.toContain("cx/gpt-5.4");
    expect(ids).toContain("cx/gpt-5.4-mini");
  });

  it("hides a compatible-node custom model disabled under its providerId even with a custom prefix", async () => {
    const providerId = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
    mocks.connections = [{
      id: "compat-1",
      provider: providerId,
      isActive: true,
      apiKey: "tok",
      providerSpecificData: { baseUrl: "https://compat.example/v1", prefix: "mycompat" },
    }];
    mocks.customModels = [
      { id: "hidden-model", providerAlias: providerId },
      { id: "visible-model", providerAlias: providerId },
    ];
    mocks.disabledModels = { [providerId]: ["hidden-model"] };

    const ids = (await buildModelsList([LLM_KIND])).map((model) => model.id);
    expect(ids).not.toContain("mycompat/hidden-model");
    expect(ids).toContain("mycompat/visible-model");
  });
});
