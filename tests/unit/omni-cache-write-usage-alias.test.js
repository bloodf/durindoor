import { describe, expect, it } from "vitest";
import { canonicalizeUsage, extractUsage, mergeUsage, normalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

describe("OmniRoute cache-write aliases", () => {
  it.each([
    { cache_write_tokens: 12 },
    { prompt_tokens_details: { cache_write_tokens: 12 } },
    { input_tokens_details: { cache_write_tokens: 12 } },
  ])("keeps inclusive prompt totals through normalization and stream extraction: %o", (alias) => {
    const raw = { prompt_tokens: 100, completion_tokens: 8, cached_tokens: 20, ...alias };
    const normalized = normalizeUsage(raw);
    expect(normalized.cache_creation_input_tokens).toBe(12);
    expect(normalizeUsage(normalized)).toEqual(normalized);
    expect(canonicalizeUsage(raw)).toMatchObject({ prompt_tokens: 100, cached_tokens: 20, cache_creation_input_tokens: 12 });
    expect(canonicalizeUsage(extractUsage({ usage: raw }))).toMatchObject({ prompt_tokens: 100, cache_creation_input_tokens: 12 });
  });

  it("preserves precedence, zero, absence and late merged usage", () => {
    expect(normalizeUsage({ prompt_tokens: 10, cache_creation_input_tokens: 0, cache_write_tokens: 9 }).cache_creation_input_tokens).toBe(0);
    expect(normalizeUsage({ prompt_tokens: 10, prompt_tokens_details: { cache_write_tokens: 0 } }).cache_creation_input_tokens).toBe(0);
    expect(normalizeUsage({ prompt_tokens: 10 }).cache_creation_input_tokens).toBeUndefined();
    const early = extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 1 } });
    const late = extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 8, cache_write_tokens: 12 } });
    expect(canonicalizeUsage(mergeUsage(early, late))).toMatchObject({ prompt_tokens: 100, completion_tokens: 8, cache_creation_input_tokens: 12 });
    const response = extractUsage({ type: "response.completed", response: { usage: { input_tokens: 100, output_tokens: 8, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 12 } } } });
    expect(canonicalizeUsage(response)).toMatchObject({ prompt_tokens: 100, cached_tokens: 20, cache_creation_input_tokens: 12 });
  });
});

describe("Responses usage in Claude conversion", () => {
  it("tracks usage-only chunks and keeps terminal events unchanged", () => {
    const state = { toolCalls: new Map() };
    openaiToClaudeResponse({ choices: [{ delta: { content: "hello" } }] }, state);
    expect(openaiToClaudeResponse({ choices: [], usage: { input_tokens: 100, output_tokens: 8, input_tokens_details: { cached_tokens: 20, cache_creation_tokens: 12 } } }, state)).toBeNull();
    expect(state.usage).toEqual({ input_tokens: 68, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 12 });
    const events = openaiToClaudeResponse({ choices: [{ delta: {}, finish_reason: "stop" }] }, state);
    expect(events.filter((event) => event.type === "message_delta")[0].usage).toEqual(state.usage);
    expect(events.filter((event) => event.type === "message_stop")).toHaveLength(1);
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });

  it("prefers numeric Chat fields, including zero, and falls back per detail", () => {
    const state = {};
    openaiToClaudeResponse({ choices: [], usage: { prompt_tokens: 0, input_tokens: 100, completion_tokens: 0, output_tokens: 8, prompt_tokens_details: { cached_tokens: 0, cache_creation_tokens: "bad" }, input_tokens_details: { cached_tokens: 20, cache_creation_tokens: 0 } } }, state);
    expect(state.usage).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 });
  });
});
