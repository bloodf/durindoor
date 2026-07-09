import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  PROVIDER_MEDIA,
  PROVIDER_MODELS,
} from "open-sse/providers/index.js";
import { deriveRerankUrl } from "open-sse/handlers/rerankCore.js";
import { parseModel } from "open-sse/services/model.js";
import openrouter from "open-sse/providers/registry/openrouter.js";

// #6574 — OpenRouter exposes a Cohere-compatible POST /api/v1/rerank endpoint
// (confirmed live: openrouter.ai/cohere/rerank-4-pro). The capability/model catalog
// missed rerank registration, so clients could not discover or route OpenRouter rerank
// models reliably.
describe("openrouter rerank provider registration", () => {
  it("parseModel resolves openrouter multi-slash rerank model id", () => {
    expect(parseModel("openrouter/cohere/rerank-4-pro")).toEqual({
      provider: "openrouter",
      model: "cohere/rerank-4-pro",
      isAlias: false,
      providerAlias: "openrouter",
    });
  });
  it("openrouter registry includes rerank service kind", () => {
    expect(openrouter.serviceKinds).toContain("rerank");
  });

  it("PROVIDER_MODELS.openrouter contains the rerank model ids", () => {
    const ids = new Set(PROVIDER_MODELS.openrouter.map((m) => m.id));
    expect(ids.has("cohere/rerank-4-pro")).toBe(true);
    expect(ids.has("cohere/rerank-4-fast")).toBe(true);
    expect(ids.has("cohere/rerank-v3.5")).toBe(true);

    const rerank = PROVIDER_MODELS.openrouter.find((m) => m.id === "cohere/rerank-4-pro");
    expect(rerank?.kind).toBe("rerank");
  });

  it("deriveRerankUrl resolves openrouter to its Cohere-compatible /rerank endpoint", () => {
    const url = deriveRerankUrl(PROVIDERS.openrouter, PROVIDER_MEDIA.openrouter);
    expect(url).toBe("https://openrouter.ai/api/v1/rerank");
  });
});
