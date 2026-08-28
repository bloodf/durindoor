import { describe, expect, it } from "vitest";

import { toResponsesUsage } from "../../open-sse/translator/concerns/usage.js";
import { calculateCostFromTokens, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { canonicalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";

describe("toResponsesUsage detail translation", () => {
  it("preserves inclusive nested details in matching flat fields", () => {
    expect(toResponsesUsage({
      prompt_tokens: 12,
      completion_tokens: 7,
      total_tokens: 19,
      prompt_tokens_details: { cached_tokens: 4, cache_creation_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 3, accepted_prediction_tokens: 1 },
    })).toEqual({
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      cached_tokens: 4,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cached_tokens: 4, cache_creation_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 3, accepted_prediction_tokens: 1 },
    });
  });

  it("preserves inclusive flat cache fields without changing input totals", () => {
    expect(toResponsesUsage({
      input_tokens: 8,
      output_tokens: 5,
      cached_tokens: 6,
      cache_creation_input_tokens: 1,
      reasoning_tokens: 4,
    })).toEqual({
      input_tokens: 8,
      output_tokens: 5,
      total_tokens: 13,
      cached_tokens: 6,
      cache_creation_input_tokens: 1,
      input_tokens_details: { cached_tokens: 6, cache_creation_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 4 },
    });
  });

  it("folds exclusive flat cache fields once and omits cache_read_input_tokens", () => {
    const once = toResponsesUsage({
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 2,
    });

    expect(once).toEqual({
      input_tokens: 18,
      output_tokens: 7,
      total_tokens: 25,
      cached_tokens: 4,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cached_tokens: 4, cache_creation_tokens: 2 },
    });
    expect(toResponsesUsage(once)).toEqual(once);
  });

  it("keeps cache-creation-only Responses usage idempotent", () => {
    const once = toResponsesUsage({
      input_tokens: 12,
      output_tokens: 7,
      cache_creation_input_tokens: 2,
    });

    expect(once).toEqual({
      input_tokens: 14,
      output_tokens: 7,
      total_tokens: 21,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cache_creation_tokens: 2 },
    });
    expect(toResponsesUsage(once)).toEqual(once);
  });

  it("gives exclusive flat fields precedence over conflicting nested details", () => {
    expect(toResponsesUsage({
      input_tokens: 12,
      output_tokens: 7,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cached_tokens: 40, cache_creation_tokens: 20, audio_tokens: 1 },
    })).toEqual({
      input_tokens: 18,
      output_tokens: 7,
      total_tokens: 25,
      cached_tokens: 4,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cached_tokens: 4, cache_creation_tokens: 2, audio_tokens: 1 },
    });
  });

  it("clears stale nested creation when only flat cache read selects exclusive normalization", () => {
    const once = toResponsesUsage({
      input_tokens: 12,
      output_tokens: 7,
      cache_read_input_tokens: 4,
      input_tokens_details: { cache_creation_tokens: 20, audio_tokens: 1 },
    });

    expect(once).toEqual({
      input_tokens: 16,
      output_tokens: 7,
      total_tokens: 23,
      cached_tokens: 4,
      input_tokens_details: { cached_tokens: 4, audio_tokens: 1 },
    });
    expect(toResponsesUsage(once)).toEqual(once);
  });

  it("clears stale nested read when only flat cache creation selects exclusive normalization", () => {
    const once = toResponsesUsage({
      input_tokens: 12,
      output_tokens: 7,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cached_tokens: 40, audio_tokens: 1 },
    });

    expect(once).toEqual({
      input_tokens: 14,
      output_tokens: 7,
      total_tokens: 21,
      cache_creation_input_tokens: 2,
      input_tokens_details: { cache_creation_tokens: 2, audio_tokens: 1 },
    });
    expect(toResponsesUsage(once)).toEqual(once);
  });

  it("clears stale nested cache values when exclusive flat fields are explicitly zero", () => {
    const once = toResponsesUsage({
      input_tokens: 12,
      output_tokens: 7,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      input_tokens_details: { cached_tokens: 40, cache_creation_tokens: 20, audio_tokens: 1 },
    });

    expect(once).toEqual({
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      input_tokens_details: { audio_tokens: 1 },
    });
    expect(toResponsesUsage(once)).toEqual(once);
  });

  it("keeps raw, translated, and extracted billing fields and costs equal", () => {
    const raw = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      input_tokens_details: { cache_creation_tokens: 7, audio_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 20 },
    };
    const translated = toResponsesUsage(raw);
    const canonicalTranslated = canonicalizeUsage(translated);
    const direct = canonicalizeUsage(raw);
    const extracted = canonicalizeUsage(extractUsage({
      type: "response.completed",
      response: { usage: translated },
    }));

    expect(canonicalTranslated).toEqual(direct);
    expect(extracted).toEqual(direct);
    expect(direct).toEqual({
      prompt_tokens: 110,
      completion_tokens: 50,
      total_tokens: 160,
      cached_tokens: 10,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 20,
    });
    const pricing = getPricingForModel(null, "gpt-5.2");
    const directCost = calculateCostFromTokens(direct, pricing);
    expect(calculateCostFromTokens(canonicalTranslated, pricing)).toBe(directCost);
    expect(calculateCostFromTokens(extracted, pricing)).toBe(directCost);
  });
});
