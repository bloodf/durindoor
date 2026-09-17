import { describe, it, expect } from "vitest";
import { canonicalizeUsage, extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens, getPricingForModel } from "../../open-sse/providers/pricing.js";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

// Canonical convention (single source of truth for storage + cost):
//   prompt_tokens             = total input INCLUDING cache read + cache creation
//   cached_tokens             = cache-read portion (subset of prompt_tokens)
//   cache_creation_input_tokens = cache-write portion (subset of prompt_tokens)
//   completion_tokens         = output
// Discriminator: Claude reports cache separately (prompt EXCLUDES cache);
// OpenAI/Gemini report prompt INCLUDING cached_tokens.
describe("canonicalizeUsage", () => {
  it("folds Claude exclusive cache into an inclusive prompt count", () => {
    // Claude: input_tokens excludes cache; cache_read + cache_creation are separate
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    expect(out.prompt_tokens).toBe(330); // 100 + 200 + 30
    expect(out.completion_tokens).toBe(50);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(30);
  });

  it("passes through OpenAI inclusive prompt unchanged", () => {
    // OpenAI: prompt_tokens already includes cached_tokens (a subset)
    const out = canonicalizeUsage({
      prompt_tokens: 330,
      completion_tokens: 50,
      cached_tokens: 200,
    });
    expect(out.prompt_tokens).toBe(330);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("passes through Gemini inclusive prompt (cachedContent already counted)", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 500,
      completion_tokens: 80,
      cached_tokens: 120,
      reasoning_tokens: 40,
    });
    expect(out.prompt_tokens).toBe(500);
    expect(out.cached_tokens).toBe(120);
    expect(out.reasoning_tokens).toBe(40);
  });

  it("preserves an authoritative Gemini total through extraction and canonicalization", () => {
    const extracted = toOpenAIUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      thoughtsTokenCount: 10,
      totalTokenCount: 150,
    }, "gemini");
    const out = canonicalizeUsage(extracted);
    expect(out).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 50,
      reasoning_tokens: 10,
      total_tokens: 150,
    });
  });

  it("handles no-cache usage", () => {
    const out = canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 50 });
    expect(out.prompt_tokens).toBe(100);
    expect(out.cached_tokens).toBe(0);
    expect(out.cache_creation_input_tokens).toBe(0);
  });

  it("is idempotent (running twice yields the same canonical shape)", () => {
    const once = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    const twice = canonicalizeUsage(once);
    expect(twice.prompt_tokens).toBe(330);
    expect(twice.cached_tokens).toBe(200);
    expect(twice.cache_creation_input_tokens).toBe(30);
    expect(twice.completion_tokens).toBe(50);
  });

  it("returns null for invalid input", () => {
    expect(canonicalizeUsage(null)).toBeNull();
    expect(canonicalizeUsage(undefined)).toBeNull();
  });

  it("folds a Claude cache-miss first write (cache_creation only, no cache_read yet)", () => {
    // Cache-miss on first write: upstream emits cache_creation_input_tokens but
    // no cache_read_input_tokens at all (not even 0). Must still fold into prompt
    // instead of falling through to the OpenAI passthrough branch.
    const out = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      cache_creation_input_tokens: 500,
    });
    expect(out.prompt_tokens).toBe(600); // 100 + 0 (no read) + 500
    expect(out.cached_tokens).toBe(0);
    expect(out.cache_creation_input_tokens).toBe(500);
  });
});

describe("calculateCostFromTokens (canonical inclusive convention)", () => {
  const pricing = { input: 3, output: 15, cached: 0.3, cache_creation: 3.75 };

  it("prices cached + cache_creation as subsets of an inclusive prompt without double-counting", () => {
    // prompt=330 includes 200 cached + 30 cache_creation → 100 full-price input
    const cost = calculateCostFromTokens(
      { prompt_tokens: 330, completion_tokens: 50, cached_tokens: 200, cache_creation_input_tokens: 30 },
      pricing
    );
    const expected =
      (100 * 3 + 200 * 0.3 + 30 * 3.75 + 50 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("does not let cache_creation drive nonCached negative", () => {
    // pathological: cached + creation exceeds prompt → nonCached clamps at 0
    const cost = calculateCostFromTokens(
      { prompt_tokens: 100, completion_tokens: 0, cached_tokens: 80, cache_creation_input_tokens: 40 },
      pricing
    );
    const expected = (0 * 3 + 80 * 0.3 + 40 * 3.75) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("matches plain input pricing when no cache present", () => {
    const cost = calculateCostFromTokens({ prompt_tokens: 100, completion_tokens: 50 }, pricing);
    expect(cost).toBeCloseTo((100 * 3 + 50 * 15) / 1_000_000, 12);
  });

  it("trusts provider-reported dollar cost when available", () => {
    expect(calculateCostFromTokens({ prompt_tokens: 100, completion_tokens: 50, cost_in_usd: 0.123 }, pricing)).toBe(0.123);
    expect(calculateCostFromTokens({ prompt_tokens: 100, completion_tokens: 50, cost_in_usd_ticks: 123000000000 }, pricing)).toBe(0.123);
  });

  it("prices reasoning as a subset of completion instead of billing it twice", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 20 },
      { ...pricing, reasoning: 30 },
    );
    const expected = (100 * 3 + 30 * 15 + 20 * 30) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("charges OpenAI reasoning tokens once at the output rate", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 10_000, cached_tokens: 9_000, completion_tokens: 500, reasoning_tokens: 300 },
      { input: 1.75, output: 14, cached: 0.175, reasoning: 14 },
    );
    expect(cost).toBeCloseTo((1_000 * 1.75 + 9_000 * 0.175 + 500 * 14) / 1_000_000, 12);
  });

  // Long-context tiers. Most vendors bill the higher rate only once a request
  // exceeds the threshold; xAI applies it to requests that reach it exactly.
  const tiered = {
    input: 2,
    output: 6,
    cached: 0.3,
    reasoning: 6,
    longContextThreshold: 200_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 2,
  };

  it("bills ordinary rates below the long-context threshold", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 199_999, completion_tokens: 1_000 },
      tiered,
    );
    expect(cost).toBeCloseTo((199_999 * 2 + 1_000 * 6) / 1_000_000, 12);
  });

  it("bills the long-context tier above the threshold, cached tokens included", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 300_000, cached_tokens: 100_000, completion_tokens: 1_000 },
      tiered,
    );
    // Long-context doubles input, cached and output alike.
    expect(cost).toBeCloseTo((200_000 * 4 + 100_000 * 0.6 + 1_000 * 12) / 1_000_000, 12);
  });

  it("keeps an exclusive threshold exclusive at the exact boundary", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 200_000, completion_tokens: 1_000 },
      tiered,
    );
    expect(cost).toBeCloseTo((200_000 * 2 + 1_000 * 6) / 1_000_000, 12);
  });

  it("applies an inclusive threshold at the exact boundary", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 200_000, completion_tokens: 1_000 },
      { ...tiered, longContextInclusive: true },
    );
    expect(cost).toBeCloseTo((200_000 * 4 + 1_000 * 12) / 1_000_000, 12);
  });
});

describe("published vendor rates", () => {
  // https://docs.x.ai/developers/pricing — Grok 4.5/4.6 are $2/$6 per 1M with a
  // 200k long-context tier that doubles both, applied when a request *reaches*
  // the threshold. They differ only in the cached rate.
  it("prices Grok 4.5 and 4.6 variants from their published rates, not the grok-* fallback", () => {
    for (const model of ["grok-4.5", "grok-4.5-high", "grok-4.6", "grok-4.6-xhigh"]) {
      const pricing = getPricingForModel("gb", model);
      expect(pricing.input).toBe(2);
      expect(pricing.output).toBe(6);
      expect(pricing.longContextThreshold).toBe(200_000);
      expect(pricing.longContextInclusive).toBe(true);
    }
    expect(getPricingForModel("gb", "grok-4.5").cached).toBe(0.3);
    expect(getPricingForModel("gb", "grok-4.6").cached).toBe(0.5);
  });

  it("charges a 200k-token Grok 4.6 request at the long-context tier", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 200_000, completion_tokens: 10_000 },
      getPricingForModel("gb", "grok-4.6"),
    );
    expect(cost).toBeCloseTo((200_000 * 4 + 10_000 * 12) / 1_000_000, 12);
  });

  it("leaves older Grok models on the family fallback", () => {
    for (const model of ["grok-3", "grok-4", "grok-code-fast-1"]) {
      expect(getPricingForModel("gb", model).longContextThreshold).toBeUndefined();
    }
  });

  // Anthropic lists Claude Opus 4 at $15 input / $75 output per 1M.
  // The row previously carried output 25.00 against reasoning 112.50, billing
  // reasoning at 4.5x its own output rate.
  it("prices Claude Opus 4 reasoning consistently with its own output rate", () => {
    const pricing = getPricingForModel("anthropic", "claude-opus-4-20250514");
    expect(pricing.input).toBe(15);
    expect(pricing.output).toBe(75);
    expect(pricing.reasoning).toBeCloseTo(pricing.output * 1.5, 12);
  });
});

describe("Anthropic streaming usage (message_start carries cache, message_delta output-only)", () => {
  it("extractUsage reads input + cache from message_start", () => {
    const u = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } },
    });
    expect(u.prompt_tokens).toBe(100);
    expect(u.cache_read_input_tokens).toBe(200);
    expect(u.cache_creation_input_tokens).toBe(30);
  });

  it("merges message_start cache with message_delta output without clobbering", () => {
    // Real Anthropic SSE: cache only in message_start, real output only in message_delta.
    const start = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } },
    });
    const delta = extractUsage({ type: "message_delta", usage: { output_tokens: 50 } });
    const merged = mergeUsage(start, delta);
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.cache_read_input_tokens).toBe(200);
    expect(merged.cache_creation_input_tokens).toBe(30);
    expect(merged.completion_tokens).toBe(50);

    // And it canonicalizes to a cache-inclusive prompt for storage/cost.
    const canon = canonicalizeUsage(merged);
    expect(canon.prompt_tokens).toBe(330); // 100 + 200 + 30
    expect(canon.cached_tokens).toBe(200);
    expect(canon.cache_creation_input_tokens).toBe(30);
    expect(canon.completion_tokens).toBe(50);
  });

  it("does not let a NaN field poison the running max-merge", () => {
    // typeof NaN === "number", so a naive Math.max(prev, NaN) is NaN — one
    // malformed chunk must not wipe out an already-accumulated good value.
    const prev = { prompt_tokens: 100, cache_read_input_tokens: 200 };
    const bad = { prompt_tokens: NaN, completion_tokens: 50 };
    const merged = mergeUsage(prev, bad);
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.cache_read_input_tokens).toBe(200);
    expect(merged.completion_tokens).toBe(50);
  });
});

describe("Kiro usage pass-through", () => {
  it("passes through plain input/output when no cache fields are present", () => {
    const out = toOpenAIUsage({ inputTokens: 100, outputTokens: 50 }, "kiro");
    expect(out.prompt_tokens).toBe(100);
    expect(out.completion_tokens).toBe(50);
    expect(out.total_tokens).toBe(150);
    expect(out.prompt_tokens_details).toBeUndefined();
  });

  it("forward-compat: surfaces cache fields if Kiro event shape grows them", () => {
    // ponytail: Amazon Q upstream doesn't expose cache today, but if it starts
    // sending cache_read_input_tokens / cache_creation_input_tokens / cachedTokens,
    // cost tracking should pick them up automatically without another change.
    const out = toOpenAIUsage(
      { inputTokens: 500, outputTokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 },
      "kiro"
    );
    expect(out.prompt_tokens_details).toBeDefined();
    expect(out.prompt_tokens_details.cached_tokens).toBe(200);
    expect(out.prompt_tokens_details.cache_creation_tokens).toBe(50);
  });
});
