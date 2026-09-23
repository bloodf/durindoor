import { describe, expect, it } from "vitest";

import {
  ADAPTIVE_EFFORT,
  applyAdaptiveEffort,
  hasExplicitReasoningField,
  isAdaptiveEffort,
  resolveAdaptiveEffort,
} from "../../open-sse/services/adaptiveEffort.js";

// Port of OmniRoute #13448: adaptive reasoning effort resolver. Deterministic
// low/medium/high bands from the last user turn's shape only.
function userMsg(content) {
  return { role: "user", content };
}

describe("adaptiveEffort (#13448 port)", () => {
  it("ADAPTIVE_EFFORT is the literal auto marker", () => {
    expect(ADAPTIVE_EFFORT).toBe("auto");
  });

  it("resolveAdaptiveEffort: no messages -> medium (never cheap by default)", () => {
    expect(resolveAdaptiveEffort(undefined)).toBe("medium");
    expect(resolveAdaptiveEffort(null)).toBe("medium");
    expect(resolveAdaptiveEffort([])).toBe("medium");
  });

  it("resolveAdaptiveEffort: trivial short first turn -> low", () => {
    expect(resolveAdaptiveEffort([userMsg("hi there")])).toBe("low");
  });

  it("resolveAdaptiveEffort: long user turn -> high", () => {
    const longMsg = userMsg("x".repeat(5000));
    expect(resolveAdaptiveEffort([longMsg])).toBe("high");
  });

  it("resolveAdaptiveEffort: prior tool results push into medium/high", () => {
    const messages = [
      userMsg("do a thing"),
      { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
      { role: "tool", content: "result 1" },
      { role: "tool", content: "result 2" },
      { role: "tool", content: "result 3" },
      { role: "tool", content: "result 4" },
      { role: "tool", content: "result 5" },
      { role: "tool", content: "result 6" },
      userMsg("continue"),
    ];
    expect(resolveAdaptiveEffort(messages)).toBe("high");
  });

  it("resolveAdaptiveEffort: per-turn pin stabilizes once a tool round-trip starts", () => {
    const base = [userMsg("short")];
    const afterOneRoundTrip = [
      ...base,
      { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
      { role: "tool", content: "result" },
    ];
    const afterTwoRoundTrips = [
      ...afterOneRoundTrip,
      { role: "assistant", content: "", tool_calls: [{ id: "2" }] },
      { role: "tool", content: "x".repeat(10000) },
    ];
    // Content added after the last user message never changes estCtxTokens
    // (computed only up to the boundary) or the pre-boundary tool count, so
    // once the loop is past its first round-trip the level is pinned: adding
    // more tool iterations of the SAME turn does not re-resolve it.
    expect(resolveAdaptiveEffort(afterTwoRoundTrips)).toBe(resolveAdaptiveEffort(afterOneRoundTrip));
  });

  it("isAdaptiveEffort matches case-insensitively and trims whitespace", () => {
    expect(isAdaptiveEffort("auto")).toBe(true);
    expect(isAdaptiveEffort("Auto")).toBe(true);
    expect(isAdaptiveEffort(" AUTO ")).toBe(true);
    expect(isAdaptiveEffort("low")).toBe(false);
    expect(isAdaptiveEffort(undefined)).toBe(false);
    expect(isAdaptiveEffort(null)).toBe(false);
  });

  it("hasExplicitReasoningField detects any of the three shapes", () => {
    expect(hasExplicitReasoningField({})).toBe(false);
    expect(hasExplicitReasoningField({ reasoning_effort: "high" })).toBe(true);
    expect(hasExplicitReasoningField({ reasoning: { effort: "low" } })).toBe(true);
    expect(hasExplicitReasoningField({ thinking: { type: "enabled" } })).toBe(true);
  });

  it("applyAdaptiveEffort: no-op without header opt-in", () => {
    const body = { messages: [userMsg("hi")] };
    expect(applyAdaptiveEffort(body, {})).toBe(body);
  });

  it("applyAdaptiveEffort: no-op when an explicit reasoning field is present", () => {
    const body = { messages: [userMsg("hi")], reasoning_effort: "low" };
    const result = applyAdaptiveEffort(body, { headerEffort: "auto" });
    expect(result).toBe(body);
  });

  it("applyAdaptiveEffort: resolves auto into a concrete reasoning_effort", () => {
    const body = { messages: [userMsg("hi")] };
    const result = applyAdaptiveEffort(body, { headerEffort: "auto" });
    expect(result).not.toBe(body);
    expect(result.reasoning_effort).toBe("low");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("applyAdaptiveEffort: falls back to body.messages when opts.messages is omitted", () => {
    const body = { messages: [userMsg("x".repeat(5000))] };
    const result = applyAdaptiveEffort(body, { headerEffort: "auto" });
    expect(result.reasoning_effort).toBe("high");
  });
});
