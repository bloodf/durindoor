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

  it("fetches OpenAI-compatible registry models when static models are empty", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "hcnsec-live" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    stubConnections([
      {
        id: "conn-hcnsec",
        provider: "hcnsec",
        apiKey: "hk",
        isActive: true,
        providerSpecificData: {},
      },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    expect(models.some((m) => m.id === "hcnsec/hcnsec-live")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.hcnsec.cn/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer hk" }),
      }),
    );

    vi.unstubAllGlobals();
  });
});
