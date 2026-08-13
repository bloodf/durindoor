import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  resolveKiroModels: vi.fn(),
  resolveCopilotModels: vi.fn(),
  proxyAwareFetch: vi.fn(),
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

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: mocks.resolveKiroModels,
}));

vi.mock("open-sse/services/copilotModels.js", () => ({
  resolveCopilotModels: mocks.resolveCopilotModels,
}));

vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

describe("/v1/models OAuth proxy routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue([]);
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("passes each connection's resolved route to Kiro and Copilot catalogs", async () => {
    const kiroData = {
      oauthProxy: { mode: "strict-pool", poolId: "kiro-pool" },
    };
    const githubData = {
      oauthProxy: { mode: "direct" },
      copilotToken: "copilot-token",
    };
    const kiroRoute = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://kiro-proxy.internal:8080",
      strictProxy: true,
      disableEnvProxy: true,
    };
    const githubRoute = {
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      strictProxy: false,
      disableEnvProxy: true,
    };
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "kiro-1",
        provider: "kiro",
        isActive: true,
        accessToken: "kiro-access",
        refreshToken: "kiro-refresh",
        providerSpecificData: kiroData,
      },
      {
        id: "github-1",
        provider: "github",
        isActive: true,
        accessToken: "github-access",
        providerSpecificData: githubData,
      },
    ]);
    mocks.resolveConnectionProxyConfig.mockImplementation(async (data) => (
      data === kiroData ? kiroRoute : githubRoute
    ));
    mocks.resolveKiroModels.mockResolvedValue({
      models: [{ id: "claude-test", name: "Claude Test" }],
    });
    mocks.resolveCopilotModels.mockResolvedValue({
      models: [{ id: "gpt-test", name: "GPT Test" }],
    });

    const models = await buildModelsList([LLM_KIND]);

    expect(models.some((model) => model.id === "kr/claude-test")).toBe(true);
    expect(models.some((model) => model.id === "gh/gpt-test")).toBe(true);

    expect(mocks.resolveKiroModels).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "kiro-access" }),
      expect.objectContaining({ proxyOptions: kiroRoute })
    );
    expect(mocks.resolveCopilotModels).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "github-access" }),
      expect.objectContaining({ proxyOptions: githubRoute })
    );
  });

  it("routes the ollama-local /api/tags probe through the connection proxy", async () => {
    const localData = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.local:8080" };
    const localRoute = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.local:8080",
      strictProxy: true,
      disableEnvProxy: true,
    };
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-local",
        provider: "ollama-local",
        authType: "apikey",
        apiKey: "local",
        isActive: true,
        providerSpecificData: localData,
      },
    ]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue(localRoute);
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "nomic-embed-text" }] }),
    });

    const models = await buildModelsList(["embedding"], "block-metadata");

    expect(models.some((m) => m.id === "ollama-local/nomic-embed-text")).toBe(true);
    // guardedProbeFetch keeps redirect:manual (SSRF guard) while the injected
    // fetcher carries the exact resolved connection route.
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
      localRoute,
    );
  });
});
