import { describe, expect, it } from "vitest";

import { calculateCostFromTokens, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { canonicalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";

function streamWithUsage(usage) {
  const body = [
    `event: response.created\ndata: ${JSON.stringify({ response: { id: "resp_592", created_at: 1 } })}`,
    `event: response.completed\ndata: ${JSON.stringify({ response: { id: "resp_592", status: "completed", usage } })}`,
  ].join("\n\n");

  return new Blob([body]).stream();
}

describe("Responses SSE-to-JSON usage", () => {
  it("keeps nested cache details coherent across direct and extracted cost paths", async () => {
    const rawUsage = {
      input_tokens: 10_000,
      output_tokens: 500,
      total_tokens: 10_500,
      input_tokens_details: { cached_tokens: 9_000, cache_creation_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 300, accepted_prediction_tokens: 7 },
    };
    const result = await convertResponsesStreamToJson(streamWithUsage(rawUsage));

    expect(result.usage).toEqual({
      input_tokens: 10_000,
      output_tokens: 500,
      total_tokens: 10_500,
      cached_tokens: 9_000,
      cache_creation_input_tokens: 40,
      input_tokens_details: { cached_tokens: 9_000, cache_creation_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 300, accepted_prediction_tokens: 7 },
    });

    const direct = canonicalizeUsage(rawUsage);
    const extracted = canonicalizeUsage(extractUsage({ type: "response.completed", response: { usage: result.usage } }));
    expect(extracted).toEqual(direct);
    expect(direct).toEqual({
      prompt_tokens: 10_000,
      completion_tokens: 500,
      total_tokens: 10_500,
      cached_tokens: 9_000,
      cache_creation_input_tokens: 40,
      reasoning_tokens: 300,
    });
    const pricing = getPricingForModel(null, "gpt-5.2");
    expect(calculateCostFromTokens(direct, pricing)).toBeCloseTo(0.010325, 12);
    expect(calculateCostFromTokens(extracted, pricing)).toBeCloseTo(0.010325, 12);
    expect(formatDoneLine({ usage: result.usage, latency: { total: 1 } })).toBe(
      "DONE 1ms · IN 10000 (CACHE ↻9000 +40) · OUT 500",
    );
  });

  it("folds flat cache-read usage once across direct and extracted cost paths", async () => {
    const rawUsage = {
      input_tokens: 1_000,
      output_tokens: 120,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 20,
      reasoning_tokens: 90,
    };
    const result = await convertResponsesStreamToJson(streamWithUsage(rawUsage));

    expect(result.usage).toEqual({
      input_tokens: 1_920,
      output_tokens: 120,
      total_tokens: 2_040,
      cached_tokens: 900,
      cache_creation_input_tokens: 20,
      input_tokens_details: { cached_tokens: 900, cache_creation_tokens: 20 },
      output_tokens_details: { reasoning_tokens: 90 },
    });

    const direct = canonicalizeUsage(rawUsage);
    const extracted = canonicalizeUsage(extractUsage({ type: "response.completed", response: { usage: result.usage } }));
    expect(extracted).toEqual(direct);
    expect(direct).toEqual({
      prompt_tokens: 1_920,
      completion_tokens: 120,
      total_tokens: 2_040,
      cached_tokens: 900,
      cache_creation_input_tokens: 20,
      reasoning_tokens: 90,
    });
    expect(canonicalizeUsage(direct)).toEqual(direct);
    const pricing = getPricingForModel(null, "gpt-5.2");
    expect(calculateCostFromTokens(direct, pricing)).toBeCloseTo(0.0036225, 12);
    expect(calculateCostFromTokens(extracted, pricing)).toBeCloseTo(0.0036225, 12);
    expect(formatDoneLine({ usage: result.usage, latency: { total: 1 } })).toBe(
      "DONE 1ms · IN 1920 (CACHE ↻900 +20) · OUT 120",
    );
  });
});
