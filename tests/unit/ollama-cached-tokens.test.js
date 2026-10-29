/**
 * Regression for #1365 / upstream 4662724: Ollama prompt_eval_cached_count →
 * cached_tokens on both non-stream (extractUsageFromResponse) and stream
 * (extractUsage) paths. Semantics: cache-INCLUSIVE prompt (see
 * https://docs.ollama.com/api/usage); cached is a subset, never added again
 * into prompt/total or double-billed by calculateCostFromTokens.
 */
import { describe, it, expect } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { canonicalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";

describe("Ollama prompt_eval_cached_count → cached_tokens (#1365)", () => {
  it("non-stream extractUsageFromResponse surfaces cache without changing prompt/total", () => {
    expect(extractUsageFromResponse({
      model: "gpt-oss:120b",
      done: true,
      done_reason: "stop",
      prompt_eval_count: 100,
      eval_count: 20,
      prompt_eval_cached_count: 80
    })).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 80 }
    });
  });

  it("non-stream absent/null/invalid cached equals main (no cache detail)", () => {
    const base = {
      model: "gpt-oss:120b",
      done: true,
      prompt_eval_count: 26,
      eval_count: 282
    };
    const expected = {
      prompt_tokens: 26,
      completion_tokens: 282,
      total_tokens: 308
    };
    expect(extractUsageFromResponse(base)).toEqual(expected);
    expect(extractUsageFromResponse({ ...base, prompt_eval_cached_count: null })).toEqual(expected);
    expect(extractUsageFromResponse({ ...base, prompt_eval_cached_count: undefined })).toEqual(expected);
    expect(extractUsageFromResponse({ ...base, prompt_eval_cached_count: Number.NaN })).toEqual(expected);
    expect(extractUsageFromResponse({ ...base, prompt_eval_cached_count: -1 })).toEqual(expected);
    expect(extractUsageFromResponse({ ...base, prompt_eval_cached_count: "80" })).toEqual(expected);
  });

  it("stream extractUsage surfaces cache without changing prompt/total", () => {
    expect(extractUsage({
      model: "llama3",
      done: true,
      prompt_eval_count: 100,
      eval_count: 20,
      prompt_eval_cached_count: 80
    })).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cached_tokens: 80
    });
  });

  it("stream absent/null/invalid cached equals main (no cached_tokens key)", () => {
    const base = {
      model: "llama3",
      done: true,
      prompt_eval_count: 30,
      eval_count: 20
    };
    const expected = {
      prompt_tokens: 30,
      completion_tokens: 20,
      total_tokens: 50
    };
    expect(extractUsage(base)).toEqual(expected);
    expect(extractUsage({ ...base, prompt_eval_cached_count: null })).toEqual(expected);
    expect(extractUsage({ ...base, prompt_eval_cached_count: undefined })).toEqual(expected);
    expect(extractUsage({ ...base, prompt_eval_cached_count: Number.NaN })).toEqual(expected);
    expect(extractUsage({ ...base, prompt_eval_cached_count: -3 })).toEqual(expected);
    expect(extractUsage({ ...base, prompt_eval_cached_count: "80" })).toEqual(expected);
  });

  it("canonicalize + cost treat cached as inclusive subset (no double count)", () => {
    const extracted = extractUsage({
      done: true,
      prompt_eval_count: 100,
      eval_count: 20,
      prompt_eval_cached_count: 80
    });
    const canon = canonicalizeUsage(extracted);
    expect(canon).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cached_tokens: 80,
      cache_creation_input_tokens: 0
    });

    // Pricing: input rate on non-cached only; cached at cached rate.
    // If prompt were exclusive, non-cached would be billed as 100 instead of 20.
    const pricing = { input: 1_000_000, output: 2_000_000, cached: 100_000 };
    expect(calculateCostFromTokens(canon, pricing)).toBe(
      // non-cached input 20 * 1 + cached 80 * 0.1 + output 20 * 2
      20 * 1 + 80 * 0.1 + 20 * 2
    );
  });
});
