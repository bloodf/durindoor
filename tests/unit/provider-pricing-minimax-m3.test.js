import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING,
  calculateCostFromTokens,
  getPricingForModel,
} from "../../open-sse/providers/pricing.js";

const LONG_CONTEXT = {
  threshold: 512_000,
  input: 0.60,
  output: 2.40,
  cached: 0.12,
};

describe("MiniMax-M3 pricing", () => {
  it.each(["MiniMax-M3", "minimax-m3"])("exposes the long-context tier on %s", (model) => {
    const pricing = getPricingForModel(null, model);

    expect(pricing).toBe(MODEL_PRICING[model]);
    expect(pricing).toMatchObject({
      input: 0.30,
      output: 1.20,
      cached: 0.06,
      longContext: LONG_CONTEXT,
    });
  });

  it("keeps the base tier at exactly 512K canonical input tokens", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 512_000, completion_tokens: 100 },
      MODEL_PRICING["MiniMax-M3"],
    );

    expect(cost).toBeCloseTo((512_000 * 0.30 + 100 * 1.20) / 1_000_000, 12);
  });

  it.each([
    ["prompt_tokens", "completion_tokens"],
    ["input_tokens", "output_tokens"],
  ])("uses the long tier above 512K with %s/%s aliases", (inputKey, outputKey) => {
    const cost = calculateCostFromTokens(
      { [inputKey]: 512_001, [outputKey]: 100 },
      MODEL_PRICING["MiniMax-M3"],
    );

    expect(cost).toBeCloseTo((512_001 * 0.60 + 100 * 2.40) / 1_000_000, 12);
  });

  it("uses long-tier cached/output rates while preserving reasoning and cache-creation semantics", () => {
    const pricing = {
      ...MODEL_PRICING["MiniMax-M3"],
      reasoning: 9,
      cache_creation: 7,
    };
    const cost = calculateCostFromTokens({
      prompt_tokens: 600_000,
      cached_tokens: 100_000,
      cache_creation_input_tokens: 50_000,
      completion_tokens: 100,
      reasoning_tokens: 20,
    }, pricing);
    const expected = (
      450_000 * 0.60
      + 100_000 * 0.12
      + 50_000 * 7
      + 80 * 2.40
      + 20 * 9
    ) / 1_000_000;

    expect(cost).toBeCloseTo(expected, 12);
  });

  it.each([
    [{ prompt_tokens: 600_000, cost_usd: 0.123 }, 0.123],
    [{ input_tokens: 600_000, cost_in_usd: 0.456 }, 0.456],
  ])("keeps direct provider cost authoritative", (tokens, expected) => {
    expect(calculateCostFromTokens(tokens, MODEL_PRICING["MiniMax-M3"])).toBe(expected);
  });

  it("leaves flat custom pricing unchanged", () => {
    const flatPricing = { input: 3, output: 15, cached: 0.30 };
    const cost = calculateCostFromTokens(
      { prompt_tokens: 600_000, cached_tokens: 100_000, completion_tokens: 100 },
      flatPricing,
    );

    expect(cost).toBeCloseTo((500_000 * 3 + 100_000 * 0.30 + 100 * 15) / 1_000_000, 12);
  });
});