import { describe, expect, it } from "vitest";
import { allocateUsageCost } from "@/shared/utils/usageCostAllocation";

function sum(allocation) {
  return Object.values(allocation).reduce((total, value) => total + value, 0);
}

describe("usage cost display allocation", () => {
  it("allocates normal prompt, cache, output, and reasoning categories", () => {
    const allocation = allocateUsageCost({
      promptTokens: 10,
      cachedTokens: 2,
      cacheCreationTokens: 1,
      completionTokens: 5,
      reasoningTokens: 3,
      cost: 9,
    });
    expect(sum(allocation)).toBeCloseTo(9, 12);
    expect(allocation.reasoningCost).toBeGreaterThan(0);
  });

  it("still sums to total when cache subsets exceed reported prompt", () => {
    const allocation = allocateUsageCost({
      promptTokens: 1,
      cachedTokens: 5,
      cacheCreationTokens: 2,
      completionTokens: 2,
      reasoningTokens: 1,
      cost: 4.25,
    });
    expect(allocation.inputCost).toBe(0);
    expect(sum(allocation)).toBeCloseTo(4.25, 12);
  });
});
