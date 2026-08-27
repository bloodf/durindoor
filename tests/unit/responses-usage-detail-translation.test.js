import { describe, expect, it } from "vitest";

import { toResponsesUsage } from "../../open-sse/translator/concerns/usage.js";

describe("toResponsesUsage detail translation", () => {
  it("preserves normalized detail objects and folds flat provider fields", () => {
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
      input_tokens_details: { cached_tokens: 4, cache_creation_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 3, accepted_prediction_tokens: 1 },
    });

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
      input_tokens_details: { cached_tokens: 6, cache_creation_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 4 },
    });
  });
});
