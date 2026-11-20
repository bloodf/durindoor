// Offline capability/translation fixtures for the #1072 model-capability residuals
// ported from upstream 9router #5354 (Qwen 3.8 Flash-Next window) and #5355
// (tiered Gemini MINIMAL floor).
//
// Everything here is derived from the local capability tables: no provider call,
// no network, no credentials. See
// internal/docs/port-reports/1072-model-capability-residuals.md for the
// source disposition and the behavior contract.
import { describe, expect, it } from "vitest";
import {
  PATTERN_CAPABILITIES,
  getCapabilitiesForModel,
  resolveModelLimits,
} from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const patternIndex = (pattern) => PATTERN_CAPABILITIES.findIndex((row) => row.pattern === pattern);

// Native Gemini wire shape for the direct Google lane (top-level generationConfig).
const geminiThinking = (provider, model, intent) => {
  const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
  applyThinking(provider, model, body, provider, intent, getCapabilitiesForModel(provider, model));
  return body.generationConfig?.thinkingConfig;
};

describe("#5354 Qwen 3.8 Flash-Next window", () => {
  it("keeps the flash-next row above the generic qwen3.8 row (first match wins)", () => {
    const flashNext = patternIndex("*qwen3.8*flash*next*");
    const family = patternIndex("*qwen3.8*");
    expect(flashNext).toBeGreaterThan(-1);
    expect(flashNext).toBeLessThan(family);
    // The 3.8 rows that own their own windows stay ahead of both.
    expect(patternIndex("*qwen3.8*omni*")).toBeLessThan(flashNext);
    expect(patternIndex("*qwen3.8*27b*")).toBeLessThan(flashNext);
  });

  it("resolves the open-weight flash-next SKU at its 262144/131072 caps on unregistered gateways", () => {
    // Gateways outside the static registry get no synced-catalog overlay, so the
    // pattern table decides alone (the reported case was a hand-added amd lane).
    for (const [provider, id] of [
      ["amd", "Qwen3.8-Flash-Next"],
      [null, "qwen3.8-flash-next"],
      ["vultr", "qwen3.8-flash-next@eu"],
      ["requesty", "qwen3.8-flash-next"],
    ]) {
      const caps = getCapabilitiesForModel(provider, id);
      expect(caps.vision).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("qwen-effort");
      expect(caps.contextWindow).toBe(262144);
      expect(caps.maxOutput).toBe(131072);
      expect(resolveModelLimits(provider, id)).toEqual({
        contextWindow: 262144,
        maxOutput: 131072,
        known: true,
        source: "pattern",
      });
    }
  });

  it("leaves the hosted Qwen 3.8 API family on its 1M window", () => {
    expect(resolveModelLimits("amd", "qwen3.8-flash")).toEqual({
      contextWindow: 1000000,
      maxOutput: 131072,
      known: true,
      source: "pattern",
    });
    expect(resolveModelLimits("amd", "qwen3.8-max")).toMatchObject({ contextWindow: 1000000, maxOutput: 131072 });
    expect(resolveModelLimits("amd", "qwen/qwen3.8-max")).toMatchObject({ contextWindow: 1000000, maxOutput: 131072 });
    // Sibling 3.8 weights keep their own windows.
    expect(resolveModelLimits("amd", "qwen3.8-27b")).toMatchObject({ contextWindow: 262144, maxOutput: 262144 });
    expect(resolveModelLimits("amd", "qwen3.8-2.4t-a95b")).toMatchObject({ contextWindow: 262144 });
    expect(resolveModelLimits("amd", "qwen3.8-omni-flash")).toMatchObject({ contextWindow: 262144, maxOutput: 65536 });
  });

  it("keeps provider-declared rows and operator overrides ahead of the pattern row", () => {
    // nan declares its own qwen3.8-flash row; it never reached the pattern table.
    expect(resolveModelLimits("nan", "qwen3.8-flash")).toMatchObject({ contextWindow: 262144, source: "provider" });
    expect(getCapabilitiesForModel("nan", "qwen3.8-flash").thinkingFormat).toBe("openai");
    // An explicit operator override still wins over the discovered window.
    const override = { contextWindow: 500000, maxOutput: 4096, customKeys: new Set(["contextWindow", "maxOutput"]) };
    expect(resolveModelLimits("amd", "qwen3.8-flash-next", override)).toMatchObject({
      contextWindow: 500000,
      maxOutput: 4096,
      source: "custom",
    });
  });
});

describe("#5355 tiered Gemini MINIMAL floor", () => {
  it("floors the direct Google lane's 3.6/3.7 Flash tiers at low", () => {
    for (const model of ["gemini-3.7-flash", "gemini-3.6-flash"]) {
      expect(getCapabilitiesForModel("gemini", model).thinkingEfforts).toEqual(["low", "medium", "high"]);
      expect(getThinkingLevels("gemini", model)).toEqual(["low", "medium", "high"]);
      expect(geminiThinking("gemini", model, { mode: "level", level: "minimal" })).toEqual({
        thinkingLevel: "low",
        includeThoughts: true,
      });
      expect(geminiThinking("gemini", model, { mode: "level", level: "none" })).toEqual({
        thinkingLevel: "low",
        includeThoughts: true,
      });
      // A sub-768-token budget converts to "minimal", which the tier rejects.
      expect(geminiThinking("gemini", model, { mode: "budget", budget: 512 })).toEqual({
        thinkingLevel: "low",
        includeThoughts: true,
      });
    }
  });

  it("preserves explicit levels and floors invalid ones on the tiered lanes", () => {
    for (const [level, expected] of [["low", "low"], ["medium", "medium"], ["high", "high"]]) {
      expect(geminiThinking("gemini", "gemini-3.7-flash", { mode: "level", level })?.thinkingLevel).toBe(expected);
    }
    // "xhigh" and unknown spellings are not in the tiered set; they fall to high.
    expect(geminiThinking("gemini", "gemini-3.7-flash", { mode: "level", level: "xhigh" })?.thinkingLevel).toBe("high");
    expect(geminiThinking("gemini", "gemini-3.7-flash", { mode: "level", level: "banana" })?.thinkingLevel).toBe("high");
  });

  it("keeps the tier rows' limits and modalities exactly as the family row published them", () => {
    for (const model of ["gemini-3.7-flash", "gemini-3.6-flash"]) {
      const caps = getCapabilitiesForModel("gemini", model);
      expect(caps.vision).toBe(true);
      expect(caps.audioInput).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.search).toBe(true);
      expect(caps.thinkingFormat).toBe("gemini-level");
      expect(caps.thinkingCanDisable).toBe(false);
      expect(caps.contextWindow).toBe(1048576);
      expect(caps.maxOutput).toBe(65536);
      expect(resolveModelLimits("gemini", model)).toMatchObject({ contextWindow: 1048576, maxOutput: 65536 });
    }
  });

  it("keeps the documented 3.8 Flash row and the original Gemini 3 tiers unchanged", () => {
    expect(getCapabilitiesForModel("gemini", "gemini-3.8-flash").thinkingEfforts).toEqual(["low", "medium", "high"]);
    expect(geminiThinking("gemini", "gemini-3.8-flash", { mode: "level", level: "minimal" })).toEqual({
      thinkingLevel: "low",
      includeThoughts: true,
    });
    // Original Gemini 3 models do have a MINIMAL tier.
    expect(getThinkingLevels("gemini", "gemini-3-flash-preview")).toContain("minimal");
    expect(geminiThinking("gemini", "gemini-3-flash-preview", { mode: "level", level: "minimal" })).toEqual({
      thinkingLevel: "minimal",
      includeThoughts: false,
    });
    expect(getThinkingLevels("gemini", "gemini-3.1-pro-preview")).toContain("minimal");
    expect(getThinkingLevels("gemini", "gemini-3.5-flash")).toContain("minimal");
  });

  it("does not clamp lanes whose own contract is not the tiered Google lane", () => {
    // Resellers and other gateways keep their own metadata; only the provider that
    // actually rejects MINIMAL is floored.
    for (const provider of ["openrouter", "cheaperinference", "github", "opencode-zen", "tokenrouter"]) {
      expect(getCapabilitiesForModel(provider, "gemini-3.7-flash").thinkingEfforts ?? null).toBeNull();
    }
    // Antigravity keeps its own tier row (and its own no-thoughts floor).
    const antigravity = getCapabilitiesForModel("antigravity", "gemini-3.7-flash");
    expect(antigravity.thinkingEfforts).toEqual(["low", "medium", "high"]);
    expect(antigravity.thinkingFloorHidesThoughts).toBe(true);
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: {} } };
    applyThinking("antigravity", "gemini-3.7-flash", body, "antigravity", { mode: "level", level: "minimal" },
      getCapabilitiesForModel("antigravity", "gemini-3.7-flash"));
    expect(body.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low", includeThoughts: false });
  });
});
