import { afterEach, describe, expect, it, vi } from "vitest";
import groq from "../../open-sse/providers/registry/groq.js";
import { isValidModel } from "../../src/shared/constants/models.js";
import { buildModelsList, LLM_KIND } from "../../src/app/api/v1/models/buildModelsList.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(() => Promise.resolve([])),
  getCustomModels: vi.fn(() => Promise.resolve([])),
  getModelAliases: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/db/repos/settingsRepo", () => ({
  getSettings: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  getProviderValidationGuard: vi.fn(() => Promise.resolve(null)),
  guardedProbeFetch: vi.fn((url, init) => global.fetch(url, init)),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn((url, init) => global.fetch(url, init)),
}));

import { getProviderConnections } from "@/lib/localDb";
import { getSettings } from "@/lib/db/repos/settingsRepo";


describe("Groq model catalog (upstream #3558)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });


  it("enables OpenAI model discovery and unknown-model passthrough", () => {
    expect(groq.modelsFetcher).toEqual({
      url: "https://api.groq.com/openai/v1/models",
      type: "openai",
    });
    expect(groq.passthroughModels).toBe(true);
    expect(isValidModel("groq", "future-live-model")).toBe(true);
  });

  it("serves live-only Groq models with bearer auth while keeping the seed unique", async () => {
    getProviderConnections.mockResolvedValue([{
      id: "groq-1",
      provider: "groq",
      apiKey: "gsk-test",
      isActive: true,
      providerSpecificData: {},
    }]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { id: "openai/gpt-oss-120b" },
        { id: "moonshotai/kimi-k2-instruct" },
      ] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const ids = (await buildModelsList([LLM_KIND]))
      .map((model) => model.id)
      .filter((id) => id.startsWith("groq/"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer gsk-test" }),
      }),
    );
    expect(ids).toContain("groq/moonshotai/kimi-k2-instruct");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the refreshed free Groq catalog when paid models are hidden", async () => {
    const freeId = "openai/gpt-oss-20b";
    const paidId = "openai/gpt-oss-safeguard-20b";
    getSettings.mockResolvedValueOnce({ hidePaidModels: true });
    getProviderConnections.mockResolvedValue([{
      id: "groq-1",
      provider: "groq",
      apiKey: "gsk-test",
      isActive: true,
      providerSpecificData: { enabledModels: [freeId, paidId] },
    }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: freeId }, { id: paidId }] }),
    }));

    const ids = (await buildModelsList([LLM_KIND]))
      .map((model) => model.id)
      .filter((id) => id.startsWith("groq/"));

    expect(ids).toContain(`groq/${freeId}`);
    expect(ids).not.toContain(`groq/${paidId}`);
  });
});
