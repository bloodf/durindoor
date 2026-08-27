import { describe, expect, it } from "vitest";

import { getPricingForModel, MODEL_PRICING, PATTERN_PRICING } from "../../open-sse/providers/pricing.js";

const price = (input, output, cached, cacheCreation = input) => ({
  input,
  output,
  cached,
  reasoning: output,
  cache_creation: cacheCreation,
});

describe("official OpenAI standard-tier pricing", () => {
  const official = {
    "gpt-4": price(30.00, 60.00, 30.00),
    "gpt-4-turbo": price(10.00, 30.00, 10.00),
    "gpt-4o": price(2.50, 10.00, 1.25),
    "gpt-4o-mini": price(0.15, 0.60, 0.075),
    "gpt-4.1": price(2.00, 8.00, 0.50),
    "gpt-4.1-mini": price(0.40, 1.60, 0.10),
    "gpt-4.1-nano": price(0.10, 0.40, 0.025),
    "gpt-5": price(1.25, 10.00, 0.125),
    "gpt-5-mini": price(0.25, 2.00, 0.025),
    "gpt-5-nano": price(0.05, 0.40, 0.005),
    "gpt-5.1": price(1.25, 10.00, 0.125),
    "gpt-5.2": price(1.75, 14.00, 0.175),
    "gpt-5.4": price(2.50, 15.00, 0.25),
    "gpt-5.4-mini": price(0.75, 4.50, 0.075),
    "gpt-5.4-nano": price(0.20, 1.25, 0.02),
    "gpt-5.4-pro": price(30.00, 180.00, 30.00),
    "gpt-5.5": price(5.00, 30.00, 0.50),
    "gpt-5.5-pro": price(30.00, 180.00, 30.00),
    "o1": price(15.00, 60.00, 7.50),
    "o3": price(2.00, 8.00, 0.50),
    "o3-mini": price(1.10, 4.40, 0.55),
    "o3-pro": price(20.00, 80.00, 20.00),
    "o4-mini": price(1.10, 4.40, 0.275),
  };

  it.each([
    "gpt-3.5-turbo",
    "gpt-4o-2024-05-13",
    "gpt-5-pro",
    "gpt-5.2-pro",
    "gpt-5.6-cyber",
    "o1-pro",
  ])("does not add unreachable registry model %s", (model) => {
    expect(Object.hasOwn(MODEL_PRICING, model)).toBe(false);
  });

  it.each(Object.entries(official))("resolves %s", (model, expected) => {
    expect(getPricingForModel("openai", model)).toEqual(expected);
  });

  it("refreshes only GPT/o-series fallback rows", () => {
    const row = (pattern) => PATTERN_PRICING.find((entry) => entry.pattern === pattern)?.pricing;

    expect(row("gpt-5.4-*")).toEqual(price(2.50, 15.00, 0.25));
    expect(row("gpt-5.1-*")).toEqual(price(1.25, 10.00, 0.125));
    expect(row("gpt-5-*")).toEqual(price(1.25, 10.00, 0.125));
    expect(row("gpt-4o")).toEqual(price(2.50, 10.00, 1.25));
    expect(row("gpt-4*")).toEqual(price(10.00, 30.00, 10.00));
    expect(row("o1")).toEqual(price(15.00, 60.00, 7.50));
    expect(row("o3-*")).toEqual(price(2.00, 8.00, 0.50));
    expect(row("o4-*")).toEqual(price(1.10, 4.40, 0.275));
  });

  it("preserves fork GPT-5.6 tier prices and Kiro suffix resolution", () => {
    expect(getPricingForModel("kiro", "gpt-5-6-luna-thinking")).toEqual(price(1.00, 1.25, 0.10));
    expect(getPricingForModel("kr", "gpt-5.6-terra-agentic")).toEqual(price(2.50, 3.125, 0.25));
    expect(getPricingForModel("kiro", "gpt-5.6-sol-thinking-agentic")).toEqual(price(5.00, 6.25, 0.50));
  });
});
