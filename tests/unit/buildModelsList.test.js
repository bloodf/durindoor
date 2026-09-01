import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

describe("buildModelsList — Cline live catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLINE_LIVE_CATALOG = "true";
    mocks.getProviderConnections.mockResolvedValue([{
      id: "cline-oauth",
      provider: "cline",
      authType: "oauth",
      accessToken: "oauth-token",
      isActive: true,
      providerSpecificData: {},
    }]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue([]);
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.CLINE_LIVE_CATALOG;
  });

  it("merges authenticated Cline live IDs and excludes ClinePass IDs", async () => {
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { id: "openai/live-model", name: "Live Model" },
        { id: "cline-pass/not-cline", name: "Wrong Provider" },
      ] }),
    });

    const ids = (await buildModelsList([LLM_KIND])).map((model) => model.id);

    expect(ids).toContain("cl/openai/live-model");
    expect(ids).toContain("cl/z-ai/glm-5.3-flash");
    expect(ids).toContain("cl/openai/gpt-5.4");
    expect(ids).not.toContain("cl/cline-pass/not-cline");
  });

  it("keeps the static GLM fallback when live discovery fails", async () => {
    mocks.proxyAwareFetch.mockRejectedValue(new Error("offline"));

    const ids = (await buildModelsList([LLM_KIND])).map((model) => model.id);

    expect(ids).toContain("cl/z-ai/glm-5.3-flash");
  });
});
