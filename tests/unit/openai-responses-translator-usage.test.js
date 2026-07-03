import { describe, expect, it } from "vitest";

import { toResponsesUsage } from "../../open-sse/translator/concerns/usage.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import "../../open-sse/translator/response/openai-responses.js";

function completedUsage(chunks) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  for (const chunk of chunks) {
    if (chunk.usage) state.usage = chunk.usage;
    const events = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state);
    const completed = events.find((e) => e?.event === "response.completed");
    if (completed) return completed.data.response.usage;
  }
  return undefined;
}

describe("toResponsesUsage", () => {
  it("maps prompt_tokens to input_tokens", () => {
    expect(toResponsesUsage({
      prompt_tokens: 12,
      completion_tokens: 7,
      total_tokens: 19,
      prompt_tokens_details: { cached_tokens: 4 },
    })).toEqual({
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      input_tokens_details: { cached_tokens: 4 },
    });
  });

  it("returns null when no token counts are present", () => {
    expect(toResponsesUsage(null)).toBeNull();
    expect(toResponsesUsage({})).toBeNull();
  });
});

describe("openai-responses translator", () => {
  it("attaches Responses-shaped usage on response.completed", () => {
    const usage = completedUsage([
      { id: "chatcmpl-x", choices: [{ index: 0, delta: { role: "assistant", content: "hi" } }] },
      {
        id: "chatcmpl-x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, prompt_tokens_details: { cached_tokens: 4 } },
      },
    ]);
    expect(usage.input_tokens).toBe(12);
    expect(usage.input_tokens_details.cached_tokens).toBe(4);
  });

  it("omits usage when upstream never reported token counts", () => {
    expect(completedUsage([
      { id: "chatcmpl-z", choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }] },
      { id: "chatcmpl-z", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ])).toBeUndefined();
  });
});