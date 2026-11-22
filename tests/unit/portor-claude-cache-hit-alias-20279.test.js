import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function terminalUsage(usage) {
  const state = { toolCalls: new Map() };
  openaiToClaudeResponse({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] }, state);
  openaiToClaudeResponse({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, state);
  openaiToClaudeResponse({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 5, ...usage } }, state);
  return state.usage;
}

describe("OmniRoute #20279: prompt-cache-hit aliases reach Claude usage", () => {
  it("DeepSeek prompt_cache_hit_tokens becomes cache_read_input_tokens", () => {
    expect(terminalUsage({ prompt_cache_hit_tokens: 400 })).toEqual({ input_tokens: 600, output_tokens: 5, cache_read_input_tokens: 400 });
  });
  it("flat cached_tokens becomes cache_read_input_tokens", () => {
    expect(terminalUsage({ cached_tokens: 250 })).toEqual({ input_tokens: 750, output_tokens: 5, cache_read_input_tokens: 250 });
  });
  it("explicit zero hit counter is kept as reported evidence", () => {
    expect(terminalUsage({ prompt_cache_hit_tokens: 0 })).toEqual({ input_tokens: 1000, output_tokens: 5, cache_read_input_tokens: 0 });
  });
  it("canonical nested counters keep priority and invalid aliases are ignored", () => {
    expect(terminalUsage({ prompt_tokens_details: { cached_tokens: 100 }, prompt_cache_hit_tokens: 400 }).cache_read_input_tokens).toBe(100);
    expect(terminalUsage({ prompt_cache_hit_tokens: -1, cached_tokens: 30 }).cache_read_input_tokens).toBe(30);
  });
});
