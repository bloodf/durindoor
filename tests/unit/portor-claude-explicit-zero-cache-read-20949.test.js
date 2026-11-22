import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function trailingUsage(details) {
  const state = { toolCalls: new Map() };
  openaiToClaudeResponse({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] }, state);
  openaiToClaudeResponse({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, state);
  openaiToClaudeResponse({ choices: [], usage: { prompt_tokens: 50000, completion_tokens: 7, ...details } }, state);
  return state.usage;
}

describe("OmniRoute #20949: explicit zero cache read reaches Claude usage", () => {
  it.each([
    ["Chat explicit zero", { prompt_tokens_details: { cached_tokens: 0 } }, 0],
    ["Responses detail explicit zero", { input_tokens_details: { cached_tokens: 0 } }, 0],
    ["flat Claude-compatible explicit zero", { cache_read_input_tokens: 0 }, 0],
    ["positive count", { prompt_tokens_details: { cached_tokens: 43264 } }, 43264],
    ["omitted count", { prompt_tokens_details: {}, input_tokens_details: {} }, undefined],
    ["invalid counts", { prompt_tokens_details: { cached_tokens: -1 }, input_tokens_details: { cached_tokens: null }, cache_read_input_tokens: Infinity }, undefined],
    ["valid fallback after invalid count", { prompt_tokens_details: { cached_tokens: NaN }, input_tokens_details: { cached_tokens: 0 } }, 0]
  ])("%s", (_name, details, expected) => {
    const expectedUsage = {
      input_tokens: 50000 - (expected ?? 0),
      output_tokens: 7,
      ...(expected === undefined ? {} : { cache_read_input_tokens: expected })
    };
    expect(trailingUsage(details)).toEqual(expectedUsage);
  });
});
