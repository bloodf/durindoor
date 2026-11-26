import { describe, expect, it } from "vitest";
import { calculateCostFromTokens, getPricingForModel } from "../../open-sse/providers/pricing.js";

const TIERS = ["", "-low", "-medium", "-high", "-xhigh"].map((tier) => `gemini-4-neon${tier}`);
const RATE = { input: 3, output: 15, cached: 0.15, reasoning: 15, cache_creation: 3 };

describe("Gemini 4 Neon pricing (OmniRoute #20666)", () => {
  it.each([
    ["gemini", "gemini-4-neon"],
    ...["antigravity", "ag", "agy"].flatMap((provider) => TIERS.map((model) => [provider, model])),
  ])("prices %s/%s at the Neon rate", (provider, model) => {
    expect(getPricingForModel(provider, model)).toEqual(RATE);
  });

  it("keeps the rate on a wire id with a thinking preset", () => {
    expect(getPricingForModel("antigravity", "gemini-4-neon-high(high)")).toEqual(RATE);
  });

  it("bills cached input at the cached rate", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, cached_tokens: 400_000 },
      getPricingForModel("agy", "gemini-4-neon-high"),
    );
    // 0.6M x $3 + 0.4M x $0.15 + 1M x $15
    expect(cost).toBeCloseTo(16.86, 6);
  });
});
