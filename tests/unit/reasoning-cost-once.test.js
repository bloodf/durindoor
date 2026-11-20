// Upstream 9router #5634: reasoning tokens are billed ONCE.
//
// OpenAI Chat Completions and the Responses API report reasoning_tokens as a
// SUBSET of completion/output tokens, so the visible remainder is billed at the
// output rate and the reasoning slice at its own rate. A few OpenAI-compatible
// upstreams (xAI) report the reasoning ON TOP instead, and Gemini's
// thoughtsTokenCount is separate from candidatesTokenCount — there the output
// count is billed whole and the reasoning is charged on top of it.
//
// DurinDoor bills reasoning as a subset by default; the additive families mark
// themselves with `reasoning_included_in_output: 0`.
import { describe, it, expect } from "vitest";
import { extractUsage, mergeUsage, canonicalizeUsage, reasoningIsSubsetOfOutput } from "../../open-sse/utils/usageTracking.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { calculateCostFromTokens, calculateCostBreakdown } from "../../open-sse/providers/pricing.js";

const PRICING = { input: 1.25, output: 10, reasoning: 10 };
const subset = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, completion_tokens_details: { reasoning_tokens: 300 } };
const additive = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1500, completion_tokens_details: { reasoning_tokens: 300 } };

function costOfChunk(chunk) {
  return calculateCostFromTokens(canonicalizeUsage(extractUsage(chunk)), PRICING);
}

describe("reasoning tokens are charged once", () => {
  it("OpenAI chat: completion_tokens already includes reasoning_tokens", () => {
    const chunk = { usage: subset };
    // 1000 * 1.25 + 500 * 10 (reasoning is part of the 500) = 0.00625
    expect(costOfChunk(chunk)).toBeCloseTo(0.00625, 12);
  });

  it("OpenAI Responses: output_tokens already includes reasoning_tokens", () => {
    const chunk = {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          total_tokens: 1500,
          output_tokens_details: { reasoning_tokens: 300 },
        },
      },
    };
    expect(costOfChunk(chunk)).toBeCloseTo(0.00625, 12);
  });

  it("keeps the marker across a streamed merge (flag survives mergeUsage)", () => {
    const first = extractUsage({
      usage: { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } },
    });
    const second = extractUsage({ usage: { prompt_tokens: 1000, completion_tokens: 500 } });
    const merged = mergeUsage(first, second);
    expect(calculateCostFromTokens(canonicalizeUsage(merged), PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("Gemini: thoughtsTokenCount is separate from candidatesTokenCount (billed additively)", () => {
    const chunk = {
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        thoughtsTokenCount: 300,
        totalTokenCount: 1800,
      },
    };
    // 1000 * 1.25 + 500 * 10 + 300 * 10 = 0.00925
    expect(costOfChunk(chunk)).toBeCloseTo(0.00925, 12);
  });

  it("Claude: output_tokens already covers thinking and carries no reasoning field", () => {
    const start = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 1000, output_tokens: 1 } },
    });
    const delta = extractUsage({ type: "message_delta", usage: { output_tokens: 500 } });
    const merged = mergeUsage(start, delta);
    expect(merged.reasoning_tokens).toBeUndefined();
    expect(calculateCostFromTokens(canonicalizeUsage(merged), PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("usage without the marker (unknown family) keeps the subset behaviour", () => {
    // A caller that cannot tell whether reasoning is a subset (e.g. a raw
    // tokens object from a non-instrumented extractor) bills the reasoning
    // slice inside the output count — the documented DurinDoor default.
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1000, completion_tokens: 500, reasoning_tokens: 300 },
      PRICING
    );
    expect(cost).toBeCloseTo(0.00625, 12);
  });

  it("raw OpenAI usage details are not double-charged (SSE-to-JSON path)", () => {
    // sseToJsonHandler passes the upstream usage object straight through. The
    // raw object carries reasoning nested-only, and canonicalizeUsage reads
    // only top-level reasoning_tokens, so the full completion is charged once.
    const canonical = canonicalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 500,
      completion_tokens_details: { reasoning_tokens: 300 },
    });
    expect(calculateCostFromTokens(canonical, PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("honours a distinct reasoning rate without double-counting the output slice", () => {
    const pricing = { input: 1, output: 6, reasoning: 9 };
    const cost = calculateCostFromTokens(
      { prompt_tokens: 0, completion_tokens: 500, reasoning_tokens: 300 },
      pricing
    );
    // (500 - 300) * 6 + 300 * 9 = 3900 / 1e6
    expect(cost).toBeCloseTo(0.0039, 12);
  });
});

describe("additive reasoning reports (xAI-style, Gemini)", () => {
  it("detects the additive shape from the reported total", () => {
    expect(reasoningIsSubsetOfOutput(subset)).toBe(true);
    expect(reasoningIsSubsetOfOutput(additive)).toBe(false);
    expect(reasoningIsSubsetOfOutput({ prompt_tokens: 10, completion_tokens: 5 })).toBe(true);
  });

  it("bills an additive OpenAI report on top of the output count", () => {
    const usage = extractUsage({ usage: additive });
    expect(usage.reasoning_included_in_output).toBe(0);
    // 1000 * 1.25 + 200 * 10 + 300 * 10 = 0.00625
    expect(calculateCostFromTokens(canonicalizeUsage(usage), PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("keeps the subset report unmarked", () => {
    const usage = extractUsage({ usage: subset });
    expect(usage.reasoning_included_in_output).toBeUndefined();
  });

  it("marks an additive non-streaming response", () => {
    const usage = extractUsageFromResponse({ usage: additive });
    expect(usage.reasoning_included_in_output).toBe(0);
    expect(calculateCostFromTokens(usage, PRICING)).toBeCloseTo(0.00625, 12);
  });

  it("bills the additive output whole and the reasoning separately", () => {
    const breakdown = calculateCostBreakdown({
      prompt_tokens: 1000,
      completion_tokens: 200,
      reasoning_tokens: 300,
      reasoning_included_in_output: 0,
    }, PRICING);
    expect(breakdown.outputCost).toBeCloseTo(200 * 10 / 1e6, 12);
    expect(breakdown.reasoningCost).toBeCloseTo(300 * 10 / 1e6, 12);
  });
});
