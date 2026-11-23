// Port of decolua/9router #4536 (+ #4574 overlap): reasoning tokens survive the
// Responses JSON converter, the Responses->Chat usage pivot, and Chat->Claude streams.
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const usage = {
  input_tokens: 25421, output_tokens: 120,
  input_tokens_details: { cached_tokens: 24320 },
  output_tokens_details: { reasoning_tokens: 65 },
};

describe("reasoning_tokens preservation", () => {
  it("canonicalizeUsage reads nested completion/output token details", () => {
    expect(canonicalizeUsage({ prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 7 } }).reasoning_tokens).toBe(7);
    expect(canonicalizeUsage({ input_tokens: 10, output_tokens: 20, output_tokens_details: { reasoning_tokens: 9 } }).reasoning_tokens).toBe(9);
  });

  it("Responses completion -> OpenAI keeps cache and reasoning", () => {
    const state = {};
    const out = openaiResponsesToOpenAIResponse({ type: "response.completed", response: { usage } }, state);
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(65);
    expect(canonicalizeUsage(state.usage).reasoning_tokens).toBe(65);
    expect(canonicalizeUsage(state.usage).cached_tokens).toBe(24320);
  });

  it("OpenAI -> Claude stream records reasoning_tokens in state.usage", () => {
    const state = initState(FORMATS.CLAUDE);
    openaiToClaudeResponse({ id: "c1", model: "m", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] }, state);
    openaiToClaudeResponse({
      id: "c1", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 12 } },
    }, state);
    expect(canonicalizeUsage(state.usage).reasoning_tokens).toBe(12);
  });
});

describe("Responses SSE -> JSON converter usage details", () => {
  it("keeps input/output token details from response.completed", async () => {
    const sse = [
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "r1", model: "m" } })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "r1", status: "completed", usage: { ...usage, total_tokens: 25541 } } })}\n\n`,
    ].join("");
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } });
    const json = await convertResponsesStreamToJson(stream);
    expect(json.usage.output_tokens_details).toEqual({ reasoning_tokens: 65 });
    expect(json.usage.input_tokens_details).toEqual({ cached_tokens: 24320 });
  });
});
