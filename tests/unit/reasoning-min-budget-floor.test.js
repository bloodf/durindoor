import { afterEach, describe, expect, it } from "vitest";

import {
  REASONING_BUFFER_MIN_TRIGGER,
  REASONING_MIN_BUDGET_ENV,
  resolveReasoningBufferedMaxTokens,
} from "../../open-sse/services/reasoningTokenBuffer.js";

// Port of OmniRoute #12742: opt-in reasoning budget floor
// (DURINDOOR_REASONING_MIN_BUDGET). `glmt/glm-5.2` has an explicit
// maxOutput of 131072 and thinking support (see reasoning-token-buffer-6714.test.js).
const THINKING_MODEL = "glmt/glm-5.2";
const NON_THINKING_MODEL = "antigravity/claude-sonnet-4-6";

function setMinBudget(value) {
  if (value === undefined) delete process.env[REASONING_MIN_BUDGET_ENV];
  else process.env[REASONING_MIN_BUDGET_ENV] = value;
}

describe("reasoning min-budget floor (opt-in, #12742 port)", () => {
  afterEach(() => setMinBudget(undefined));

  it("env unset: the existing buffer heuristic is unaffected by the opt-in", () => {
    setMinBudget(undefined);
    // Baseline: max(current + 1000, ceil(current * 1.5)) = max(1512, 768) = 1512.
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 512)).toBe(1512);
  });

  it("env set: a budget below the floor and below the baseline buffer is raised to the floor", () => {
    setMinBudget("4096");
    // Baseline buffer for 512 is 1512 (< floor), so the floor wins.
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 512)).toBe(4096);
  });

  it("floor never lowers what the existing buffer heuristic already produces", () => {
    setMinBudget("4096");
    // Baseline buffer for 8192 is max(9192, 12288) = 12288 (> floor), floor is a no-op.
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 8192)).toBe(12288);
  });

  it("boundary: just below the floor is raised, right at the floor falls through to the buffer heuristic", () => {
    setMinBudget("4096");
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 4095)).toBe(4096);
    // At the floor, the opt-in is a no-op (floored is not > current); the
    // existing heuristic still runs: max(5096, 6144) = 6144.
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 4096)).toBe(6144);
  });

  it("probes below REASONING_BUFFER_MIN_TRIGGER stay verbatim even with a floor set", () => {
    setMinBudget("4096");
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 1)).toBe(1);
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, REASONING_BUFFER_MIN_TRIGGER - 1)).toBe(
      REASONING_BUFFER_MIN_TRIGGER - 1,
    );
  });

  it("floor is clamped by the model's explicit output cap", () => {
    setMinBudget("500000");
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 512)).toBe(131072);
  });

  it("invalid env value is ignored (same as unset)", () => {
    setMinBudget("not-a-number");
    expect(resolveReasoningBufferedMaxTokens(THINKING_MODEL, 512)).toBe(1512);
  });

  it("non-thinking model is unaffected by the floor (returns null, no adjustment)", () => {
    setMinBudget("4096");
    expect(resolveReasoningBufferedMaxTokens(NON_THINKING_MODEL, 512)).toBeNull();
  });
});
