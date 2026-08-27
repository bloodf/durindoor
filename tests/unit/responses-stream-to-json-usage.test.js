import { describe, expect, it } from "vitest";

import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

function streamWithUsage(usage) {
  const body = [
    `event: response.created\ndata: ${JSON.stringify({ response: { id: "resp_592", created_at: 1 } })}`,
    `event: response.completed\ndata: ${JSON.stringify({ response: { id: "resp_592", status: "completed", usage } })}`,
  ].join("\n\n");

  return new Blob([body]).stream();
}

describe("Responses SSE-to-JSON usage", () => {
  it("preserves normalized input and output token detail objects", async () => {
    const result = await convertResponsesStreamToJson(streamWithUsage({
      input_tokens: 10_000,
      output_tokens: 500,
      total_tokens: 10_500,
      input_tokens_details: { cached_tokens: 9_000, cache_creation_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 300, accepted_prediction_tokens: 7 },
    }));

    expect(result.usage).toEqual({
      input_tokens: 10_000,
      output_tokens: 500,
      total_tokens: 10_500,
      input_tokens_details: { cached_tokens: 9_000, cache_creation_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 300, accepted_prediction_tokens: 7 },
    });
  });

  it("normalizes chat aliases and flat provider detail fields", async () => {
    const result = await convertResponsesStreamToJson(streamWithUsage({
      prompt_tokens: 800,
      completion_tokens: 120,
      cached_tokens: 600,
      cache_creation_input_tokens: 20,
      reasoning_tokens: 90,
    }));

    expect(result.usage).toEqual({
      input_tokens: 800,
      output_tokens: 120,
      total_tokens: 920,
      input_tokens_details: { cached_tokens: 600, cache_creation_tokens: 20 },
      output_tokens_details: { reasoning_tokens: 90 },
    });
  });
});
