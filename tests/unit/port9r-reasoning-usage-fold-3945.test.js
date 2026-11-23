import { describe, expect, it } from "vitest";
import { canonicalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";

// 9router #3945 (Serenhope, commit 94024db786): a thinking model that spent its
// whole budget on reasoning can report completion_tokens 0 while its reasoning
// slice (a subset of output in the OpenAI convention) is non-zero.
describe("9router #3945 reasoning-token fold", () => {
  it("folds subset reasoning into a zero completion count", () => {
    const extracted = extractUsage({
      usage: { prompt_tokens: 4024, completion_tokens: 0, completion_tokens_details: { reasoning_tokens: 2500 } },
    });
    expect(extracted.completion_tokens).toBe(2500);
    expect(extracted.reasoning_tokens).toBe(2500);
    expect(extracted.reasoning_included_in_output).toBeUndefined();

    const canonical = canonicalizeUsage(extracted);
    expect(canonical.completion_tokens).toBe(2500);
    expect(canonical.total_tokens).toBe(6524);
  });

  it("repairs a stale explicit total when completion is folded", () => {
    const canonical = canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 0, total_tokens: 100, reasoning_tokens: 40 });
    expect(canonical.completion_tokens).toBe(40);
    expect(canonical.total_tokens).toBe(140);
  });

  it("keeps completion when it already covers reasoning", () => {
    const canonical = canonicalizeUsage({ prompt_tokens: 100, completion_tokens: 300, reasoning_tokens: 120 });
    expect(canonical.completion_tokens).toBe(300);
    expect(canonical.reasoning_tokens).toBe(120);
    expect(canonical.total_tokens).toBe(400);
  });

  it("does not fold additive reasoning, which is billed on top", () => {
    const extracted = extractUsage({
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 610, completion_tokens_details: { reasoning_tokens: 500 } },
    });
    expect(extracted.completion_tokens).toBe(10);
    expect(extracted.reasoning_included_in_output).toBe(0);

    const canonical = canonicalizeUsage(extracted);
    expect(canonical.completion_tokens).toBe(10);
    expect(canonical.reasoning_tokens).toBe(500);
    expect(canonical.total_tokens).toBe(610);
  });
});

describe("9router #3945 fold on raw additive usage", () => {
  it("canonicalizeUsage leaves raw additive usage for the caller to mark", () => {
    const canonical = canonicalizeUsage({
      prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1500, completion_tokens_details: { reasoning_tokens: 300 },
    });
    expect(canonical.completion_tokens).toBe(200);
    expect(canonical.total_tokens).toBe(1500);
  });
});
