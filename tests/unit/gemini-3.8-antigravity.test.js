import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

describe("Gemini 3.8 Flash Support & Config", () => {
  it("registers gemini-3.8-flash tiered models in antigravity provider registry", () => {
    const agIds = antigravityRegistry.models.map(m => m.id);
    expect(agIds).toContain("gemini-3.8-flash-high");
    expect(agIds).toContain("gemini-3.8-flash-medium");
    expect(agIds).toContain("gemini-3.8-flash-low");
    expect(agIds).toContain("gemini-3.8-flash");
  });

  it("registers gemini-3.8-flash in gemini provider registry", () => {
    const geminiIds = geminiRegistry.models.map(m => m.id);
    expect(geminiIds).toContain("gemini-3.8-flash");
  });

  it("resolves capabilities correctly for gemini-3.8 models with official limits", () => {
    const caps = getCapabilitiesForModel("antigravity", "gemini-3.8-flash-high");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
  });

  it("defines pricing at the upstream-published Gemini 3.8 Flash rates", () => {
    // DurinDoor does not carry gemini-3.7-flash pricing rows, so assert the
    // literal upstream rates instead of diffing against the 3.7 baseline.
    const expected = { input: 1.50, output: 7.50, cached: 0.15, reasoning: 11.25, cache_creation: 1.875 };
    expect(MODEL_PRICING["gemini-3.8-flash"]).toEqual(expected);
    expect(MODEL_PRICING["gemini-3.8-flash-high"]).toEqual(expected);
    expect(MODEL_PRICING["gemini-3.8-flash-medium"]).toEqual(expected);
    expect(MODEL_PRICING["gemini-3.8-flash-low"]).toEqual(expected);
  });
});
