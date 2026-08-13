import { describe, expect, it, vi } from "vitest";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

import * as localDb from "@/lib/localDb";
import * as disabledModelsDb from "@/lib/disabledModelsDb";

function stubConnections(connections) {
  localDb.getProviderConnections.mockResolvedValue(connections);
  localDb.getCombos.mockResolvedValue([]);
  localDb.getCustomModels.mockResolvedValue([]);
  localDb.getModelAliases.mockResolvedValue([]);
  disabledModelsDb.getDisabledModels.mockResolvedValue({});
}

describe("buildModelsList — registry modelsFetcher", () => {
  it("fetches dynamic model IDs for providers with modelsFetcher and empty static models", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qiniu-live" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    stubConnections([
      {
        id: "conn-1",
        provider: "qiniu",
        apiKey: "qk",
        isActive: true,
        providerSpecificData: {},
      },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.some((m) => m.id === "qiniu/qiniu-live")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.qnaigc.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer qk" }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("accepts openai-compatible registry fetchers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "hcnsec-live" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    stubConnections([{
      id: "conn-hcnsec",
      provider: "hcnsec",
      apiKey: "hk",
      isActive: true,
      providerSpecificData: {},
    }]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.some((m) => m.id === "hcnsec/hcnsec-live")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.hcnsec.cn/v1/models",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer hk" }) }),
    );
    vi.unstubAllGlobals();
  });
  it("merges cached live limits into a static registry catalog", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qwen-max", meta: { max_context_length: 262_144 } }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    stubConnections([{
      id: "conn-alibaba",
      provider: "alibaba",
      apiKey: "ak",
      isActive: true,
      providerSpecificData: {},
    }]);

    const first = await buildModelsList([LLM_KIND]);
    const second = await buildModelsList([LLM_KIND]);

    expect(first.find((model) => model.id === "ali/qwen-max").capabilities.contextWindow).toBe(262_144);
    expect(second.find((model) => model.id === "ali/qwen-max").capabilities.contextWindow).toBe(262_144);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
