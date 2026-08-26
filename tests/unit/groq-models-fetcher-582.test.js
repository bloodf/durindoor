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

const retiredIds = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b",
];

const currentModels = {
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
  "openai/gpt-oss-safeguard-20b": "GPT-OSS Safeguard 20B",
  "qwen/qwen3.6-27b": "Qwen3.6 27B",
  "groq/compound": "Compound",
  "groq/compound-mini": "Compound Mini",
  "allam-2-7b": "Allam 2 7B",
};

describe("Groq model catalog (upstream #3558)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("replaces retired models with the refreshed production catalog", () => {
    const catalog = Object.fromEntries(groq.models.map(({ id, name }) => [id, name]));

    expect(catalog).toMatchObject(currentModels);
    for (const id of retiredIds) expect(catalog).not.toHaveProperty(id);
  });

  it("enables OpenAI model discovery and unknown-model passthrough", () => {
    expect(groq.modelsFetcher).toEqual({
      url: "https://api.groq.com/openai/v1/models",
      type: "openai",
    });
    expect(groq.passthroughModels).toBe(true);
    expect(isValidModel("groq", "future-live-model")).toBe(true);
  });

  it("fetches Groq models with bearer auth while keeping the seed unique", async () => {
    getProviderConnections.mockResolvedValue([{
      id: "groq-1",
      provider: "groq",
      apiKey: "gsk-test",
      isActive: true,
      providerSpecificData: {},
    }]);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-oss-120b" }] }),
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
    expect(ids).toContain("groq/openai/gpt-oss-120b");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
