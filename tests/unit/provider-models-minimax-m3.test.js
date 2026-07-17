/**
 * Unit tests verifying MiniMax-M3 is registered as a first-class
 * built-in model for both the `minimax` (international) and
 * `minimax-cn` (China) providers. No registry `targetFormat` override:
 * the OpenAI-API routing lives in `getModelTargetFormat()`
 * (open-sse/config/providerModels.js, upstream decolua/9router#2533),
 * keeping the registry entry format-agnostic for non-LLM kinds.
 */

import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, getModelsByProviderId, getModelTargetFormat } from "../../open-sse/config/providerModels.js";

describe("MiniMax-M3 model registration", () => {
  it("includes MiniMax-M3 in PROVIDER_MODELS.minimax", () => {
    const models = PROVIDER_MODELS.minimax || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
    });
    expect(m3.targetFormat).toBeUndefined();
  });

  it("includes MiniMax-M3 in PROVIDER_MODELS['minimax-cn']", () => {
    const models = PROVIDER_MODELS["minimax-cn"] || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
    });
    expect(m3.targetFormat).toBeUndefined();
  });

  it("routes MiniMax-M3 through the OpenAI format via getModelTargetFormat (#2533)", () => {
    expect(getModelTargetFormat("minimax", "MiniMax-M3")).toBe("openai");
    expect(getModelTargetFormat("minimax-cn", "MiniMax-M3")).toBe("openai");
    // Other MiniMax models keep format-agnostic routing.
    expect(getModelTargetFormat("minimax", "MiniMax-M2.7")).toBeNull();
    expect(getModelTargetFormat("minimax-cn", "MiniMax-M2.7")).toBeNull();
  });

  it("exposes MiniMax-M3 through getModelsByProviderId for both provider IDs", () => {
    const intlModels = getModelsByProviderId("minimax");
    const cnModels = getModelsByProviderId("minimax-cn");

    expect(intlModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
    expect(cnModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
  });

  it("does not regress the existing M2.7 / M2.5 / M2.1 entries", () => {
    const intlIds = (PROVIDER_MODELS.minimax || []).map((m) => m.id);
    const cnIds = (PROVIDER_MODELS["minimax-cn"] || []).map((m) => m.id);

    for (const id of ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"]) {
      expect(intlIds).toContain(id);
      expect(cnIds).toContain(id);
    }
  });
});
