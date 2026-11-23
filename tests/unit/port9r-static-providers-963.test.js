import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { getProviderAlias } from "../../src/shared/constants/providers.js";

describe("9router #963 provider integrations", () => {
  it.each([
    ["canopywave", "cwv", "https://inference.canopywave.io", "xiaomimimo/mimo-v2.5"],
    ["swiftrouter", "sr", "https://api.swiftrouter.com", "gpt-5.5"],
  ])("registers %s with its own authenticated endpoints and catalog", (id, alias, host, model) => {
    expect(getProviderAlias(id)).toBe(alias);
    expect(PROVIDERS[id]).toMatchObject({ baseUrl: `${host}/v1/chat/completions`, validateUrl: `${host}/v1/models`, authType: "apikey" });
    expect(PROVIDER_MEDIA[id].modelsFetcher).toEqual({ url: `${host}/v1/models`, type: "openai" });
    expect(PROVIDER_MODELS[alias]).toContainEqual(expect.objectContaining({ id: model }));
  });

  it("exposes Morph embeddings separately from chat models", () => {
    expect(PROVIDER_MODELS.morph).toContainEqual(expect.objectContaining({ id: "morph-embedding-v4", kind: "embedding", dimensions: 1536 }));
    expect(PROVIDER_MEDIA.morph).toMatchObject({ serviceKinds: ["llm", "embedding"], embeddingConfig: { baseUrl: "https://api.morphllm.com/v1/embeddings" } });
  });

  it("retains the existing Singapore token plan integration", () => {
    expect(PROVIDERS["xiaomi-tokenplan"].baseUrl).toBe("https://token-plan-sgp.xiaomimimo.com/v1/chat/completions");
    expect(PROVIDER_MODELS["xiaomi-tokenplan"]).toContainEqual(expect.objectContaining({ id: "mimo-v2.5" }));
  });
});
