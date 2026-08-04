import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_CAPABILITIES } from "../../open-sse/providers/capabilities.js";

describe("Poolside provider", () => {
  it("registers its OpenAI transport and models", () => {
    const entry = REGISTRY.find(({ id }) => id === "poolside");

    expect(entry).toMatchObject({
      id: "poolside",
      category: "freeTier",
      authType: "apikey",
      authModes: ["apikey"],
      transport: {
        baseUrl: "https://inference.poolside.ai/v1/chat/completions",
        validateUrl: "https://inference.poolside.ai/v1/models",
      },
    });
    expect(PROVIDERS.poolside).toMatchObject({
      format: "openai",
      baseUrl: "https://inference.poolside.ai/v1/chat/completions",
    });
    expect(PROVIDER_MODELS.poolside.map(({ id }) => id)).toEqual([
      "poolside/laguna-s-2.1",
      "poolside/laguna-xs-2.1",
      "poolside/laguna-m.1",
    ]);
  });

  it("declares Laguna reasoning capabilities", () => {
    for (const model of ["laguna-s-2.1", "laguna-xs-2.1", "laguna-m.1"]) {
      expect(PROVIDER_CAPABILITIES.poolside[model]).toEqual({
        reasoning: true,
        thinkingFormat: "openai",
        contextWindow: 262000,
        maxOutput: 32000,
      });
    }
  });
});