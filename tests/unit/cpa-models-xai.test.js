import { describe, expect, it } from "vitest";
import { getDispatchUpstreamModelId, getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("CLIProxyAPI Gemini 4 Neon catalog port", () => {
  it("publishes Neon with Gemini model capabilities", () => {
    const gemini = getModelsByProviderId("gemini").find(({ id }) => id === "gemini-4-neon");
    expect(gemini).toMatchObject({ contextLength: 1048576, maxOutputTokens: 65536, supportsVision: true, toolCalling: true, supportsReasoning: true });
    expect(getCapabilitiesForModel("gemini", "gemini-4-neon")).toMatchObject({
      vision: true, reasoning: true, search: true, contextWindow: 1048576, maxOutput: 65536,
    });
  });

  it("publishes Antigravity Neon tiers with the matching upstream ids", () => {
    const models = getModelsByProviderId("antigravity");
    for (const [id, upstream] of [
      ["gemini-4-neon", "gemini-4-neon-high(high)"],
      ["gemini-4-neon-low", "gemini-4-neon-low(low)"],
      ["gemini-4-neon-medium", "gemini-4-neon-medium(medium)"],
      ["gemini-4-neon-high", "gemini-4-neon-high(high)"],
      ["gemini-4-neon-xhigh", "gemini-4-neon-xhigh(xhigh)"],
    ]) {
      const model = models.find((entry) => entry.id === id);
      expect(model).toBeDefined();
      expect(model.upstreamModelId).toBe(upstream);
      expect(getCapabilitiesForModel("antigravity", id)).toMatchObject({
        vision: true, reasoning: true, search: true, contextWindow: 1048576, maxOutput: 65536,
      });
    }
  });

  it("resolves the Neon xhigh preset in both Antigravity catalogs", () => {
    for (const provider of ["agy", "antigravity"]) {
      const models = getModelsByProviderId(provider);
      const model = models.find(({ id }) => id === "gemini-4-neon-xhigh");
      // Upstream 9router 767d7aeb0b: the XHigh row is its own wire id.
      expect(model.upstreamModelId).toBe("gemini-4-neon-xhigh(xhigh)");
      expect(getDispatchUpstreamModelId(provider, "gemini-4-neon(xhigh)")).toBe("gemini-4-neon-xhigh");
      expect(getDispatchUpstreamModelId(provider, "gemini-4-neon")).toBe("gemini-4-neon-high");
    }
  });
});
