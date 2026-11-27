import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";

describe("9router #5895 hyphenated GLM capability limits", () => {
  it("resolves hyphenated glm-5-3 and glm-5-3-flash to the canonical dotted GLM 5.3 entries", () => {
    const provider = "openai-compatible-chat-custom";
    const dotted = getCapabilitiesForModel(provider, "glm-5.3");
    const hyphenated = getCapabilitiesForModel(provider, "glm-5-3");
    expect(hyphenated).toEqual(dotted);
    expect(hyphenated.contextWindow).toBe(1000000);
    expect(hyphenated.maxOutput).toBe(131072);

    const flash = getCapabilitiesForModel(provider, "z-ai/glm-5-3-flash");
    expect(flash.vision).toBe(true);
    expect(flash.contextWindow).toBe(1000000);
    expect(flash.maxOutput).toBe(131072);
  });

  it("returns exact limits for hyphenated GLM version ids via resolveModelLimits", () => {
    const limits = resolveModelLimits("openai-compatible-chat-custom", "glm-5-3");
    expect(limits).toMatchObject({
      contextWindow: 1000000,
      maxOutput: 131072,
      known: true,
      source: "exact",
    });
  });
});
