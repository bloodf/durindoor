import { describe, expect, it } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("request detail usage extraction", () => {
  it("extracts usage from Antigravity wrapped response usageMetadata", () => {
    const usage = extractUsageFromResponse({
      response: {
        usageMetadata: {
          promptTokenCount: 77187,
          candidatesTokenCount: 236,
          totalTokenCount: 77423,
          cachedContentTokenCount: 69387,
          thoughtsTokenCount: 12,
        },
      },
    });

    expect(usage).toEqual({
      prompt_tokens: 77187,
      completion_tokens: 236,
      total_tokens: 77423,
      prompt_tokens_details: { cached_tokens: 69387 },
      completion_tokens_details: { reasoning_tokens: 12 },
    });
  });

  it("extracts inclusive Responses cache usage without refolding it", () => {
    expect(extractUsageFromResponse({
      usage: {
        input_tokens: 1_920,
        output_tokens: 120,
        total_tokens: 2_040,
        cached_tokens: 900,
        cache_creation_input_tokens: 20,
        input_tokens_details: { cached_tokens: 900, cache_creation_tokens: 20 },
        output_tokens_details: { reasoning_tokens: 90 },
      },
    })).toEqual({
      prompt_tokens: 1_920,
      completion_tokens: 120,
      total_tokens: 2_040,
      cached_tokens: 900,
      cache_creation_input_tokens: 20,
      reasoning_tokens: 90,
    });
  });
});
