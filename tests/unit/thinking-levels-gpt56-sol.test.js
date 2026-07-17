import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// GPT-5.6 effort matrix (metadata must match wire):
// Sol/Terra → max + ultra; Luna → max (no ultra); older/unrelated → neither.
describe("getThinkingLevels GPT-5.6 effort matrix", () => {
  it("gpt-5.6-sol exposes max and ultra (and keeps xhigh)", () => {
    const levels = getThinkingLevels("codex", "gpt-5.6-sol");
    expect(levels).toContain("max");
    expect(levels).toContain("ultra");
    expect(levels).toContain("xhigh");
  });

  it("gpt-5.6-terra exposes max and ultra", () => {
    const levels = getThinkingLevels("openai", "gpt-5.6-terra");
    expect(levels).toContain("max");
    expect(levels).toContain("ultra");
    expect(levels).toContain("xhigh");
  });

  it("gpt-5.6-luna exposes max but not ultra", () => {
    const levels = getThinkingLevels("openai", "gpt-5.6-luna");
    expect(levels).toContain("max");
    expect(levels).toContain("xhigh");
    expect(levels).not.toContain("ultra");
  });

  it("does not add max/ultra for other codex models", () => {
    const levels = getThinkingLevels("codex", "gpt-5.3-codex");
    expect(levels).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("does not add max/ultra for older openai models", () => {
    const levels = getThinkingLevels("openai", "gpt-5");
    expect(levels).not.toContain("max");
    expect(levels).not.toContain("ultra");
    expect(levels).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("does not add max/ultra for gpt-5.5", () => {
    const levels = getThinkingLevels("codex", "gpt-5.5");
    expect(levels || []).not.toContain("max");
    expect(levels || []).not.toContain("ultra");
  });

  // Kiro maps levels to a numeric budget clamped to 32000 (xhigh=32768 and
  // max=128000 both clamp to 32000; ultra is not in LEVEL_TO_BUDGET), so ultra
  // and max are not distinct effective tiers on the Kiro wire. The global
  // Codex patterns must not leak them into the Kiro picker (#2596).
  it("Kiro GPT-5.6 Sol exposes only effective levels (no ultra/max)", () => {
    for (const provider of ["kiro", "kr"]) {
      expect(getThinkingLevels(provider, "gpt-5.6-sol"), provider).toEqual([
        "none", "minimal", "low", "medium", "high", "xhigh",
      ]);
    }
  });

  it("Kiro GPT-5.6 Terra/Luna also drop ultra and max", () => {
    for (const provider of ["kiro", "kr"]) {
      expect(getThinkingLevels(provider, "gpt-5.6-terra"), provider).toEqual([
        "none", "minimal", "low", "medium", "high", "xhigh",
      ]);
      expect(getThinkingLevels(provider, "gpt-5.6-luna"), provider).toEqual([
        "none", "minimal", "low", "medium", "high", "xhigh",
      ]);
    }
  });
});
