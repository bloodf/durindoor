// Port of upstream 9router #4216: the usage dashboard used to split one
// blended total by token share, which priced cached input like fresh input and
// shrank output to a rounding error on cache-heavy traffic. Costs are now
// derived per category at that category's own rate.
import { describe, expect, it } from "vitest";
import { calculateCostBreakdown, calculateCostFromTokens } from "open-sse/providers/pricing.js";
import { allocateUsageCost, hasServerCostSplit } from "@/shared/utils/usageCostAllocation.js";

const pricing = { input: 3, cached: 0.3, cache_creation: 3.75, output: 15, reasoning: 30 };

describe("calculateCostBreakdown", () => {
  it("prices each category at its own rate and sums to the total", () => {
    // prompt_tokens is cache-inclusive: 330 = 100 fresh + 200 cached + 30 written.
    const tokens = {
      prompt_tokens: 330,
      completion_tokens: 50,
      cached_tokens: 200,
      cache_creation_input_tokens: 30,
    };
    const breakdown = calculateCostBreakdown(tokens, pricing);

    expect(breakdown.inputCost).toBeCloseTo(100 * 3 / 1e6, 12);
    expect(breakdown.cachedCost).toBeCloseTo(200 * 0.3 / 1e6, 12);
    expect(breakdown.cacheCreationCost).toBeCloseTo(30 * 3.75 / 1e6, 12);
    expect(breakdown.outputCost).toBeCloseTo(50 * 15 / 1e6, 12);
    expect(breakdown.reasoningCost).toBe(0);
    expect(breakdown.totalCost).toBeCloseTo(calculateCostFromTokens(tokens, pricing), 12);
  });

  it("keeps cached cheaper and output dearer per token than fresh input", () => {
    const breakdown = calculateCostBreakdown({
      prompt_tokens: 100000,
      completion_tokens: 1000,
      cached_tokens: 98000,
    }, pricing);

    const freshInputRate = breakdown.inputCost / 2000;
    expect(breakdown.cachedCost / 98000).toBeLessThan(freshInputRate);
    expect(breakdown.outputCost / 1000).toBeGreaterThan(freshInputRate);
  });

  it("bills the reasoning subset once, at the reasoning rate", () => {
    const breakdown = calculateCostBreakdown({
      prompt_tokens: 0, completion_tokens: 50, reasoning_tokens: 20,
    }, pricing);

    expect(breakdown.outputCost).toBeCloseTo(30 * 15 / 1e6, 12);
    expect(breakdown.reasoningCost).toBeCloseTo(20 * 30 / 1e6, 12);
  });

  it("carries the long-context multipliers through every input category", () => {
    const tiered = { ...pricing, longContextThreshold: 100, longContextInclusive: true, longContextInputMultiplier: 2, longContextOutputMultiplier: 2 };
    const tokens = { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 40 };

    const breakdown = calculateCostBreakdown(tokens, tiered);

    expect(breakdown.inputCost).toBeCloseTo(60 * 6 / 1e6, 12);
    expect(breakdown.cachedCost).toBeCloseTo(40 * 0.6 / 1e6, 12);
    expect(breakdown.outputCost).toBeCloseTo(10 * 30 / 1e6, 12);
  });

  it("reports a provider-supplied cost as a total with no rate split", () => {
    const breakdown = calculateCostBreakdown({ prompt_tokens: 10, completion_tokens: 10, cost_usd: 0.5 }, pricing);

    expect(breakdown.totalCost).toBe(0.5);
    expect(breakdown.inputCost).toBe(0);
    expect(breakdown.outputCost).toBe(0);
  });

  it("returns zeroes when pricing is unknown", () => {
    expect(calculateCostBreakdown({ prompt_tokens: 10 }, null).totalCost).toBe(0);
    expect(calculateCostFromTokens(null, pricing)).toBe(0);
  });
});

describe("allocateUsageCost", () => {
  const bucket = { cost: 1, promptTokens: 330, completionTokens: 50, cachedTokens: 200, cacheCreationTokens: 30, reasoningTokens: 0 };

  it("uses the server split when the bucket carries one", () => {
    const withSplit = { ...bucket, inputCost: 0.6, cachedCost: 0.1, cacheCreationCost: 0.05, outputCost: 0.2, reasoningCost: 0, unsplitCost: 0.05 };

    expect(hasServerCostSplit(withSplit)).toBe(true);
    expect(allocateUsageCost(withSplit)).toEqual({
      inputCost: 0.6, cachedCost: 0.1, cacheCreationCost: 0.05, outputCost: 0.2, reasoningCost: 0, unsplitCost: 0.05,
    });
  });

  it("falls back to a token-share split that still sums to the total", () => {
    expect(hasServerCostSplit(bucket)).toBe(false);
    const allocation = allocateUsageCost(bucket);
    const sum = allocation.inputCost + allocation.cachedCost + allocation.cacheCreationCost
      + allocation.outputCost + allocation.reasoningCost;

    expect(sum).toBeCloseTo(1, 12);
  });

  it("does not divide by zero on an empty bucket", () => {
    expect(allocateUsageCost({ cost: 5 })).toEqual({
      inputCost: 0, cachedCost: 0, cacheCreationCost: 0, outputCost: 0, reasoningCost: 0, unsplitCost: 0,
    });
  });
});
