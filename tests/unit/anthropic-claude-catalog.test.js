import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel, calculateCostBreakdown } from "../../open-sse/providers/pricing.js";
import { projectClaudeCodeModel } from "../../src/app/api/v1/models/_claudeCompat.js";

describe("Anthropic and Claude Code model catalogs", () => {
  it("exposes Claude Fable 5.1 while retaining Fable 5 and Opus 5", () => {
    const ccIds = (PROVIDER_MODELS.cc || []).map((model) => model.id);
    const anthropicIds = (PROVIDER_MODELS.anthropic || []).map((model) => model.id);

    expect(ccIds).toEqual(expect.arrayContaining([
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5",
    ]));
    expect(ccIds).not.toContain("claude-opus-5-1");
    expect(ccIds).toEqual(expect.arrayContaining(["claude-opus-4-8", "claude-opus-4-7"]));
    expect(anthropicIds).toEqual(expect.arrayContaining([
      "claude-fable-5-1",
      "claude-mythos-5-1",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]));
    expect(ccIds).toContain("claude-sonnet-5-5");
    expect(ccIds).toContain("claude-haiku-5-5");
    expect(anthropicIds).toContain("claude-haiku-5-5");
    expect(ccIds).toContain("claude-haiku-4-5-20251001");
    expect(anthropicIds).toContain("claude-haiku-4-5");
    // Retired on the Claude API (model-deprecations page, 2026-09-29).
    expect(anthropicIds).not.toContain("claude-opus-4-20250514");
    expect(anthropicIds).not.toContain("claude-sonnet-4-20250514");
    expect(anthropicIds).not.toContain("claude-3-5-sonnet-20241022");
  });

  it("resolves Haiku 5.5 as an adaptive 1M-context model on both catalogs", () => {
    for (const provider of ["anthropic", "cc"]) {
      expect(getCapabilitiesForModel(provider, "claude-haiku-5-5")).toMatchObject({
        thinkingFormat: "claude-adaptive",
        vision: true,
        reasoning: true,
        contextWindow: 1000000,
        maxOutput: 128000,
      });
    }
  });
});

describe("Claude Haiku 5.5 pricing and Claude Code projection (#1363)", () => {
  // https://platform.claude.com/docs/en/about-claude/pricing
  it("uses the published Haiku 5.5 rates, not the 4.5 pattern", () => {
    for (const id of ["claude-haiku-5-5", "claude-haiku-5.5"]) {
      expect(getPricingForModel("anthropic", id)).toMatchObject({
        input: 0.10, output: 0.50, cached: 0.01, cache_creation: 0.125,
        longContextThreshold: 100000, longContextInputMultiplier: 5, longContextOutputMultiplier: 5,
      });
    }
  });

  it("bills prompts over 100K tokens at the higher tier, including cache reads", () => {
    const pricing = getPricingForModel("anthropic", "claude-haiku-5-5");
    const small = calculateCostBreakdown({ prompt_tokens: 100_000, completion_tokens: 1_000_000 }, pricing);
    expect(small.inputCost).toBeCloseTo(0.01, 6); // at the 100K boundary: base tier
    expect(small.outputCost).toBeCloseTo(0.50, 6);
    const large = calculateCostBreakdown(
      { prompt_tokens: 1_000_000, cache_read_input_tokens: 500_000, completion_tokens: 1_000_000 }, pricing);
    expect(large.inputCost).toBeCloseTo(0.25, 6); // 500K uncached at $0.50
    expect(large.cachedCost).toBeCloseTo(0.025, 6); // 500K at $0.05
    expect(large.outputCost).toBeCloseTo(2.50, 6);
  });

  it("is projected for Claude Code by the generic rule, like its Sonnet 5.5 sibling", () => {
    // No per-model list exists in _claudeCompat.js; 1,000,000 is below its 1,048,576 [1m] cutoff for every 5.5 model.
    expect(projectClaudeCodeModel({ id: "cc/claude-haiku-5-5", owned_by: "cc" })).toBe("claude-cc/claude-haiku-5-5");
    expect(projectClaudeCodeModel({ id: "cc/claude-sonnet-5-5", owned_by: "cc" })).toBe("claude-cc/claude-sonnet-5-5");
  });
});
