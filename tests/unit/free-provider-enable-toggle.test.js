import { beforeEach, describe, expect, it, vi } from "vitest";

// Free no-auth provider enable toggle: default = all enabled. The
// `disabledFreeProviders` setting is an explicit opt-out list; providers not
// present in it behave normally.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getDisabledModels: mocks.getDisabledModels,
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
}));

describe("free provider enable toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("default settings leave free no-auth providers enabled in the catalog", async () => {
    mocks.getSettings.mockResolvedValue({});
    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList(["llm"]);
    expect(models.some((m) => m.id.startsWith("pol/"))).toBe(true);
  });

  it("disabledFreeProviders hides a free no-auth provider from the catalog", async () => {
    mocks.getSettings.mockResolvedValue({ disabledFreeProviders: ["pollinations"] });
    const { buildModelsList } = await import(
      "../../src/app/api/v1/models/buildModelsList.js"
    );
    const models = await buildModelsList(["llm"]);
    expect(models.some((m) => m.id.startsWith("pol/"))).toBe(false);
  });

  it("getProviderCredentials returns providerDisabled for an explicitly disabled free no-auth provider", async () => {
    mocks.getSettings.mockResolvedValue({ disabledFreeProviders: ["pollinations"] });
    const { getProviderCredentials } = await import(
      "../../src/sse/services/auth.js"
    );
    const credentials = await getProviderCredentials("pollinations", new Set(), "pol/openai");
    expect(credentials).toEqual({ providerDisabled: true });
  });

  it("a free no-auth provider not in the disabled set is not blocked", async () => {
    const { isFreeNoAuthProviderDisabled } = await import(
      "../../src/sse/services/freeProviderGate.js"
    );
    expect(
      isFreeNoAuthProviderDisabled("mimocode", { disabledFreeProviders: ["pollinations"] })
    ).toBe(false);
  });

  it("/v1/messages/count_tokens returns 403 for a disabled free no-auth provider", async () => {
    mocks.getSettings.mockResolvedValue({ disabledFreeProviders: ["pollinations"] });
    mocks.getModelInfo.mockResolvedValue({ provider: "pollinations", model: "openai" });

    const { handleCountTokens } = await import(
      "../../src/sse/handlers/countTokens.js"
    );
    const request = new Request("http://localhost/v1/messages/count_tokens", {
      method: "POST",
      body: JSON.stringify({ model: "pol/openai" }),
    });
    const response = await handleCountTokens(request);

    expect(response.status).toBe(403);
  });
});
