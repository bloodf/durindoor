import { describe, expect, it } from "vitest";

const { PROVIDER_MODELS_CONFIG } = await import("../../src/app/api/providers/[id]/models/modelsConfig.js");

const free = (id, extra = {}) => ({ id, pricing: { prompt: "0", completion: "0", ...extra } });

describe("OpenRouter dashboard model picker", () => {
  it("keeps only models free for both input and output", () => {
    const catalog = {
      data: [
        free("meta-llama/llama-3.3-70b-instruct:free"),
        { id: "anthropic/claude-opus-4.1", pricing: { prompt: "0.000015", completion: "0.000075" } },
        { id: "openai/gpt-5", pricing: { prompt: "0.00000125", completion: "0.00001" } },
        // zero input but paid output
        { id: "vendor/half-free:free", pricing: { prompt: "0", completion: "0.000001" } },
        // zero pricing without the :free variant id (router / preview billing elsewhere)
        free("openrouter/auto"),
      ],
    };

    const ids = PROVIDER_MODELS_CONFIG.openrouter.parseResponse(catalog).map((m) => m.id);

    expect(ids).toEqual(["meta-llama/llama-3.3-70b-instruct:free"]);
  });

  it("returns an empty list for a malformed body", () => {
    expect(PROVIDER_MODELS_CONFIG.openrouter.parseResponse(null)).toEqual([]);
    expect(PROVIDER_MODELS_CONFIG.openrouter.parseResponse({ data: "nope" })).toEqual([]);
  });
});
