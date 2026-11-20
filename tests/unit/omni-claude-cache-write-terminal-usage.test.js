import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { normalizeUsage } from "../../open-sse/utils/usageTracking.js";

// Claude terminal usage must consume the supported cache-write aliases.
//
// A Claude client reads the terminal `message_delta` usage as
// {input_tokens, output_tokens, cache_read_input_tokens,
// cache_creation_input_tokens}, where input_tokens is the UNCACHED remainder
// of an inclusive prompt count. When the upstream reports its cache write
// under the `cache_write_tokens` alias instead of the canonical
// `cache_creation_tokens` spelling, the write used to be dropped entirely:
// the cached remainder stayed inflated and `cache_creation_input_tokens` was
// omitted from the client-visible totals.
//
// Synthetic usage only — no provider call, timing, persistence or pricing is
// involved. Source: OmniRoute #11814 / #14205 follow-up.

const terminalUsage = (usage) => {
  const state = { toolCalls: new Map() };
  openaiToClaudeResponse({ choices: [{ delta: { content: "answer" } }] }, state);
  const events = openaiToClaudeResponse({
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage
  }, state);
  return events.find((event) => event.type === "message_delta").usage;
};

describe("Claude terminal usage and cache-write aliases", () => {
  it("maps a nested cache-write alias to the canonical Claude cache split", () => {
    const usage = terminalUsage({
      input_tokens: 12,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }
    });
    expect(usage).toEqual({
      input_tokens: 7,
      output_tokens: 4,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2
    });
  });

  it.each([
    ["top-level alias", { input_tokens: 12, output_tokens: 4, cache_write_tokens: 2 }],
    ["nested canonical spelling", { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 3, cache_creation_tokens: 2 } }],
    ["nested alias under prompt details", { input_tokens: 12, output_tokens: 4, prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 } }],
    ["top-level canonical field", { input_tokens: 12, output_tokens: 4, cache_creation_input_tokens: 2 }]
  ])("preserves the inclusive total through the %s", (_label, usage) => {
    // 12 is the inclusive prompt count; the cache split is subtracted out of
    // the uncached remainder. Cases without a cached_tokens report leave the
    // read side empty.
    const cached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens;
    const expected = { input_tokens: 12 - (cached ?? 0) - 2, output_tokens: 4, cache_creation_input_tokens: 2 };
    if (cached !== undefined) expected.cache_read_input_tokens = cached;
    expect(terminalUsage(usage)).toEqual(expected);
  });

  it("keeps the client-visible total inclusive and idempotent across repeats", () => {
    const usage = terminalUsage({
      input_tokens: 12,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }
    });
    // The Claude-side total is the uncached remainder of the inclusive prompt.
    expect(usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens).toBe(12);
    // A second pass over the same receipt must not shift the totals.
    const again = terminalUsage({
      input_tokens: 12,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }
    });
    expect(again).toEqual(usage);
  });

  it("honours canonical precedence and keeps explicit zero distinct from omission", () => {
    // Canonical top-level field wins over the alias.
    expect(terminalUsage({
      input_tokens: 12,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 3 },
      cache_creation_input_tokens: 2,
      cache_write_tokens: 9
    })).toEqual({
      input_tokens: 7,
      output_tokens: 4,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2
    });

    // An explicit zero is "nothing was written", not an omission: it must not
    // fall through to a larger alias value, and it stays out of the totals.
    expect(terminalUsage({
      input_tokens: 12,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 3 },
      cache_creation_input_tokens: 0,
      cache_write_tokens: 9
    })).toEqual({
      input_tokens: 9,
      output_tokens: 4,
      cache_read_input_tokens: 3
    });

    // An omitted cache write leaves the totals untouched.
    expect(terminalUsage({
      input_tokens: 12,
      output_tokens: 4,
      input_tokens_details: { cached_tokens: 3 }
    })).toEqual({
      input_tokens: 9,
      output_tokens: 4,
      cache_read_input_tokens: 3
    });
  });

  it("agrees with the canonical normalizer on the resolved cache write", () => {
    // The Claude terminal split must reuse the canonical accounting: the
    // cache-write amount it resolves has to match what the shared normalizer
    // resolves for the same receipt, including the explicit-zero case.
    const receipts = [
      { prompt_tokens: 100, completion_tokens: 8, cache_write_tokens: 12 },
      { prompt_tokens: 100, completion_tokens: 8, prompt_tokens_details: { cache_write_tokens: 12 } },
      { prompt_tokens: 100, completion_tokens: 8, input_tokens_details: { cache_write_tokens: 12 } },
      { prompt_tokens: 100, completion_tokens: 8, cache_creation_input_tokens: 12 },
      { prompt_tokens: 100, completion_tokens: 8, cache_creation_input_tokens: 0, cache_write_tokens: 9 },
      { prompt_tokens: 100, completion_tokens: 8, prompt_tokens_details: { cache_creation_tokens: 12 } },
      { prompt_tokens: 100, completion_tokens: 8 }
    ];
    for (const raw of receipts) {
      const canonicalWrite = normalizeUsage(raw).cache_creation_input_tokens ?? 0;
      const claudeWrite = terminalUsage(raw).cache_creation_input_tokens ?? 0;
      expect(claudeWrite).toBe(canonicalWrite);
    }
  });

  it("keeps usage-only chunks and the standard translator behavior unchanged", () => {
    const state = { toolCalls: new Map() };
    openaiToClaudeResponse({ choices: [{ delta: { content: "hello" } }] }, state);

    // A usage-only chunk (no choices) records the receipt without emitting
    // terminal events.
    expect(openaiToClaudeResponse({
      choices: [],
      usage: { input_tokens: 100, output_tokens: 8, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 12 } }
    }, state)).toBeNull();
    expect(state.usage).toEqual({
      input_tokens: 68,
      output_tokens: 8,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 12
    });

    const events = openaiToClaudeResponse({ choices: [{ delta: {}, finish_reason: "stop" }] }, state);
    expect(events.filter((event) => event.type === "message_delta")[0].usage).toEqual(state.usage);
    expect(events.filter((event) => event.type === "message_stop")).toHaveLength(1);
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });
});
