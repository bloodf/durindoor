// Port of decolua/9router #4574: Codex Responses cache + reasoning tokens retained.
import { describe, it, expect } from "vitest";
import { canonicalizeUsage, extractUsage } from "../../open-sse/utils/usageTracking.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

const usage = {
  input_tokens: 25421, output_tokens: 120,
  input_tokens_details: { cached_tokens: 24320 },
  output_tokens_details: { reasoning_tokens: 65 },
};

describe("Responses streaming usage", () => {
  it.each([
    { type: "response.completed", response: { usage } },
    { type: "response.done", response: { usage } },
    { usage },
  ])("extracts cache and reasoning from %j", (event) => {
    expect(canonicalizeUsage(extractUsage(event))).toMatchObject({
      prompt_tokens: 25421, completion_tokens: 120, cached_tokens: 24320, reasoning_tokens: 65,
    });
  });

  it("keeps an explicit zero cache count", () => {
    const out = extractUsage({ usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } } });
    expect(out.prompt_tokens_details).toEqual({ cached_tokens: 0 });
  });
});

describe("extractUsageFromResponse (non-stream Responses body)", () => {
  it("surfaces output_tokens_details.reasoning_tokens", () => {
    const out = extractUsageFromResponse({ usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { reasoning_tokens: 12 } } });
    expect(canonicalizeUsage(out).reasoning_tokens).toBe(12);
  });
});
