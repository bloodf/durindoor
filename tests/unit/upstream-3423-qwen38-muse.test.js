import { describe, expect, it } from "vitest";
import {
  PATTERN_CAPABILITIES,
  getCapabilitiesForModel,
} from "../../open-sse/providers/capabilities.js";
import {
  MODEL_PRICING,
  PATTERN_PRICING,
  getPricingForModel,
} from "../../open-sse/providers/pricing.js";

const price = (input, output, cached, reasoning, cache_creation) => ({
  input,
  output,
  cached,
  reasoning,
  ...(cache_creation === undefined ? {} : { cache_creation }),
});

const patternIndex = (rows, pattern) => rows.findIndex((row) => row.pattern === pattern);

describe("upstream #3423 Qwen3.8 pricing", () => {
  it.each([
    ["qwen3.8-max", price(2, 6, 0.25, 6, 2.5)],
    ["qwen3.8-27b", price(0.4, 3, 0.05, 3)],
    ["qwen3.8-2.4t-a95b", price(2, 6, 0.25, 6)],
  ])("resolves exact %s rates before the generic Qwen pattern", (model, expected) => {
    expect(MODEL_PRICING[model]).toEqual(expected);
    expect(getPricingForModel(null, model)).toBe(MODEL_PRICING[model]);
  });
});

describe("upstream #3423 ordered Muse pricing", () => {
  const patterns = [
    "*muse-spark*contributor*",
    "*muse-spark*",
    "*muse-glimmer*",
    "*muse*",
  ];

  it("keeps specific rows before the generic Muse fallback", () => {
    expect(patterns.map((pattern) => patternIndex(PATTERN_PRICING, pattern))).toEqual(
      [...patterns.map((pattern) => patternIndex(PATTERN_PRICING, pattern))].sort((a, b) => a - b),
    );
    expect(patterns.every((pattern) => patternIndex(PATTERN_PRICING, pattern) >= 0)).toBe(true);
  });

  it.each([
    ["meta/muse-spark-1.2-contributor", price(0.1, 0.2, 0.002, 0.3, 0.1)],
    ["muse-spark-1.2", price(1.25, 4.25, 0.15, 6.375, 1.25)],
    ["muse-glimmer-30b", price(0.3, 1.2, 0.04, 1.8, 0.3)],
    ["future-muse-model", price(1.25, 4.25, 0.15, 6.375, 1.25)],
  ])("resolves %s through the first matching row", (model, expected) => {
    expect(getPricingForModel(null, model)).toEqual(expected);
  });
});

describe("upstream #3423 ordered Qwen3.8 and Muse capabilities", () => {
  it("keeps Qwen3.8 exceptions ahead of overlapping fallbacks", () => {
    const open = patternIndex(PATTERN_CAPABILITIES, "*qwen3.8-2.4t*");
    const family = patternIndex(PATTERN_CAPABILITIES, "*qwen3.8*");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(family).toBeGreaterThan(open);
    expect(family).toBeLessThan(patternIndex(PATTERN_CAPABILITIES, "*qwen*max*"));
    expect(family).toBeLessThan(patternIndex(PATTERN_CAPABILITIES, "*qwen*"));
  });

  it("keeps Muse specializations ahead of the generic Muse fallback", () => {
    const spark = patternIndex(PATTERN_CAPABILITIES, "*muse-spark*");
    const glimmer = patternIndex(PATTERN_CAPABILITIES, "*muse-glimmer*");
    const generic = patternIndex(PATTERN_CAPABILITIES, "*muse*");
    expect(spark).toBeGreaterThanOrEqual(0);
    expect(glimmer).toBeGreaterThan(spark);
    expect(generic).toBeGreaterThan(glimmer);
  });

  it("keeps Qwen3.8 2.4T text-only while the rest of Qwen3.8 is multimodal", () => {
    expect(getCapabilitiesForModel(null, "qwen3.8-2.4t-a95b")).toMatchObject({
      vision: false,
      videoInput: false,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 262144,
    });
    expect(getCapabilitiesForModel(null, "qwen3.8-max")).toMatchObject({
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 1000000,
      maxOutput: 65536,
    });
  });

  it.each(["qwen3.7-max", "Qwen3.6-Max-Preview"])(
    "preserves existing vision capability for %s",
    (model) => {
      expect(getCapabilitiesForModel(null, model)).toMatchObject({
        vision: true,
        reasoning: true,
        thinkingFormat: "qwen",
        contextWindow: 1000000,
        maxOutput: 65536,
      });
    },
  );

  it("advertises Muse Spark, Glimmer, and family fallback capabilities", () => {
    expect(getCapabilitiesForModel(null, "muse-spark-1.2")).toMatchObject({
      vision: true,
      videoInput: true,
      audioInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1048576,
    });
    expect(getCapabilitiesForModel(null, "muse-glimmer-30b")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 128000,
    });
    expect(getCapabilitiesForModel(null, "future-muse-model")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 128000,
    });
  });

  it("preserves the exact CommandCode Muse thinking override", () => {
    expect(getCapabilitiesForModel("commandcode", "meta/muse-spark-1.2-contributor")).toMatchObject({
      reasoning: true,
      thinkingFormat: "commandcode",
      thinkingCanDisable: false,
      maxOutput: 32768,
    });
  });
});
