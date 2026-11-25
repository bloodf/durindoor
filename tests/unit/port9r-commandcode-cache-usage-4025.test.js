// Command Code reports prompt-cache reads inside an inclusive inputTokens count.
import { describe, expect, it } from "vitest";

import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";
import { canonicalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostBreakdown } from "../../open-sse/providers/pricing.js";

const RAW = {
  inputTokens: 22044,
  inputTokenDetails: { noCacheTokens: 156, cacheReadTokens: 21888 },
  outputTokens: 30,
  totalTokens: 22074,
  cachedInputTokens: 21888,
  reasoningTokens: 16
};

describe("upstream PR #4025 - Command Code prompt-cache reads", () => {
  it("passes cache reads and reasoning through as details without inflating the totals", () => {
    const usage = toOpenAIUsage(RAW, "commandcode");

    expect(usage).toMatchObject({ prompt_tokens: 22044, completion_tokens: 30, total_tokens: 22074 });
    expect(usage.prompt_tokens_details).toEqual({ cached_tokens: 21888 });
    expect(usage.completion_tokens_details).toEqual({ reasoning_tokens: 16 });
  });

  it.each([
    ["inputTokenDetails.cacheReadTokens", { inputTokenDetails: { cacheReadTokens: 40 } }],
    ["cacheReadTokens", { cacheReadTokens: 40 }]
  ])("reads cache hits from %s", (_field, fields) => {
    const usage = toOpenAIUsage({ inputTokens: 50, outputTokens: 5, ...fields }, "commandcode");

    expect(usage.prompt_tokens).toBe(50);
    expect(usage.prompt_tokens_details).toEqual({ cached_tokens: 40 });
  });

  it("reads reasoning from outputTokenDetails", () => {
    const usage = toOpenAIUsage({ inputTokens: 5, outputTokens: 9, outputTokenDetails: { reasoningTokens: 4 } }, "commandcode");

    expect(usage.completion_tokens_details).toEqual({ reasoning_tokens: 4 });
  });

  it("adds no detail objects when nothing was cached or reasoned", () => {
    const usage = toOpenAIUsage({ inputTokens: 8, outputTokens: 2 }, "commandcode");

    expect(usage).toEqual({ prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 });
  });

  it("bills the cached part of the final stream chunk once, at the cached rate", () => {
    const state = initState(FORMATS.OPENAI);
    const chunks = [
      { type: "text-delta", text: "hi" },
      { type: "finish", finishReason: "stop", totalUsage: RAW }
    ].flatMap((event) => translateResponse(FORMATS.COMMANDCODE, FORMATS.OPENAI, JSON.stringify(event), state) || []);
    const tokens = canonicalizeUsage(extractUsage(chunks.at(-1)));

    expect(tokens).toMatchObject({ prompt_tokens: 22044, cached_tokens: 21888, completion_tokens: 30, reasoning_tokens: 16 });
    const cost = calculateCostBreakdown(tokens, { input: 1, cached: 0.1, output: 2 });
    expect(cost.inputCost).toBeCloseTo(156 / 1e6, 12);
    expect(cost.cachedCost).toBeCloseTo(21888 * 0.1 / 1e6, 12);
    expect(cost.outputCost + cost.reasoningCost).toBeCloseTo(30 * 2 / 1e6, 12);
  });
});
