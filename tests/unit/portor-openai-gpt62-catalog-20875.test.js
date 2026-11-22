import { describe, expect, it } from "vitest";
import { getProviderModels, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("GPT-6.2 Sol / Astra on the OpenAI API (port of OmniRoute #20875)", () => {
  it("lists both models in the openai registry, routed through Responses", () => {
    const ids = getProviderModels("openai").map((m) => m.id);
    for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
      expect(ids).toContain(id);
      expect(getModelTargetFormat("openai", id)).toBe("openai-responses");
    }
  });

  it("prices both models so usage is not costed at $0", () => {
    expect(getPricingForModel("openai", "gpt-6.2-sol")).toMatchObject({ input: 2, output: 10, cached: 0.2 });
    expect(getPricingForModel("openai", "gpt-6.2-astra")).toMatchObject({ input: 8, output: 40, cached: 0.4 });
  });

  it("resolves published API capabilities", () => {
    for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
      expect(getCapabilitiesForModel("openai", id)).toMatchObject({ tools: true, reasoning: true, contextWindow: 1050000, maxOutput: 128000 });
    }
  });
});
