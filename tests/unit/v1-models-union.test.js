import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("../../open-sse/services/usage/codex.js", () => ({ getCodexModels: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn().mockResolvedValue({}) }));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";

function stubConnection(providerSpecificData = {}, apiKey = "account-key") {
  localDb.getProviderConnections.mockResolvedValue([{
    id: "alibaba-connection",
    provider: "alibaba",
    apiKey,
    isActive: true,
    providerSpecificData,
  }]);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue([]);
  localDb.getModelAliases.mockResolvedValue([]);
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
}

function liveModelsResponse(ids) {
  return { ok: true, json: async () => ({ data: ids.map((id) => ({ id })) }) };
}

describe("/v1/models registry live catalog union", () => {
  beforeEach(() => {
    clearLiveModelLimitsCache();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("unions an unknown live ID with static IDs for a modelsFetcher provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(liveModelsResponse(["account-preview"])));
    stubConnection({}, "union-key");

    const ids = (await buildModelsList([LLM_KIND])).map(({ id }) => id);

    expect(ids).toContain("ali/qwen-max");
    expect(ids).toContain("ali/account-preview");
  });

  it("enriches an explicit allowlist's selected model cap without adding live siblings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "only-allowed", context_length: 200_000 },
          { id: "account-preview" },
        ],
      }),
    }));
    stubConnection({ enabledModels: ["only-allowed"] }, "allowlist-key");

    const models = await buildModelsList([LLM_KIND]);
    const aliIds = models.map(({ id }) => id).filter((id) => id.startsWith("ali/"));

    expect(aliIds).toEqual(["ali/only-allowed"]);
    expect(models.find(({ id }) => id === "ali/only-allowed").capabilities.contextWindow).toBe(200_000);
  });

  it("keeps static IDs when live discovery fails", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchSpy);
    stubConnection({}, "failure-key");

    const ids = (await buildModelsList([LLM_KIND])).map(({ id }) => id);

    expect(fetchSpy).toHaveBeenCalled();
    expect(ids).toContain("ali/qwen-max");
  });

  it("keeps same-provider private live catalogs scoped to each credential", async () => {
    const alibabaModelsUrl = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models";
    const fetchSpy = vi.fn(async (url, init) => {
      if (url !== alibabaModelsUrl) return liveModelsResponse([]);
      const token = init.headers.Authorization;
      return liveModelsResponse([token === "Bearer credential-a" ? "private-a" : "private-b"]);
    });
    vi.stubGlobal("fetch", fetchSpy);

    stubConnection({}, "credential-a");
    const firstIds = (await buildModelsList([LLM_KIND])).map(({ id }) => id);
    stubConnection({}, "credential-b");
    const secondIds = (await buildModelsList([LLM_KIND])).map(({ id }) => id);

    expect(firstIds).toContain("ali/private-a");
    expect(firstIds).not.toContain("ali/private-b");
    expect(secondIds).toContain("ali/private-b");
    expect(secondIds).not.toContain("ali/private-a");
    expect(fetchSpy.mock.calls.filter(([url]) => url === alibabaModelsUrl)).toHaveLength(2);
  });

  it.each(["http://127.0.0.1:3000/v1/models", "http://192.168.1.20/v1/models"])("rejects private models endpoints before fetch: %s", async (endpoint) => {
    const fetchSpy = vi.fn(async (url) =>
      liveModelsResponse(url === endpoint ? ["private-ssrf"] : []));
    vi.stubGlobal("fetch", fetchSpy);
    const originalFetcher = AI_PROVIDERS.alibaba?.modelsFetcher;
    if (!AI_PROVIDERS.alibaba) throw new Error("alibaba registry entry missing in test env");
    AI_PROVIDERS.alibaba.modelsFetcher = { url: endpoint, type: "openai" };
    try {
      stubConnection({}, "ssrf-key");
      const ids = (await buildModelsList([LLM_KIND], "public-only")).map(({ id }) => id);
      expect(ids).toContain("ali/qwen-max");
      expect(ids).not.toContain("ali/private-ssrf");
      expect(fetchSpy.mock.calls.some(([url]) => url === endpoint)).toBe(false);
    } finally {
      AI_PROVIDERS.alibaba.modelsFetcher = originalFetcher;
    }
  });
});
