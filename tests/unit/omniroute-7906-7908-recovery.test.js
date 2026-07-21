import { describe, it, expect } from "vitest";
import { isLocalStreamLifecycleError } from "../../open-sse/utils/streamLifecycle.js";
import {
  isAnthropicThinkingSignatureError,
  stripHistoricalThinkingForSignatureRecovery,
} from "../../open-sse/handlers/chatCore/thinkingSignatureRecovery.js";

describe("OmniRoute #7908 — local stream lifecycle classification", () => {
  it("treats a DOM AbortError as a local lifecycle event", () => {
    expect(isLocalStreamLifecycleError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isLocalStreamLifecycleError({ name: "AbortError" })).toBe(true);
  });

  it("recognizes the plain-text abort shapes", () => {
    for (const msg of [
      "request_signal_aborted",
      "Client disconnected: peer closed",
      "The operation was aborted",
      "controller is already closed",
    ]) {
      expect(isLocalStreamLifecycleError(msg)).toBe(true);
      expect(isLocalStreamLifecycleError({ message: msg })).toBe(true);
    }
  });

  it("does NOT classify genuine upstream failures as local aborts", () => {
    expect(isLocalStreamLifecycleError("502 Bad Gateway")).toBe(false);
    expect(isLocalStreamLifecycleError({ message: "rate limited" })).toBe(false);
    expect(isLocalStreamLifecycleError({ name: "TimeoutError", message: "timed out" })).toBe(false);
    expect(isLocalStreamLifecycleError(null)).toBe(false);
    expect(isLocalStreamLifecycleError("")).toBe(false);
  });
});

describe("OmniRoute #7906 — Anthropic thinking-signature error matching", () => {
  it("matches only the exact 400 signature error on an Anthropic target", () => {
    expect(
      isAnthropicThinkingSignatureError({ provider: "claude", status: 400, message: "Invalid signature in thinking block" }),
    ).toBe(true);
    expect(
      isAnthropicThinkingSignatureError({ provider: "anthropic-compatible-x", status: 400, message: "invalid `signature` in `thinking` block" }),
    ).toBe(true);
  });

  it("does not match generic 400s, other providers, or the wrong message", () => {
    expect(isAnthropicThinkingSignatureError({ provider: "claude", status: 400, message: "bad request" })).toBe(false);
    expect(isAnthropicThinkingSignatureError({ provider: "claude", status: 429, message: "Invalid signature in thinking block" })).toBe(false);
    expect(isAnthropicThinkingSignatureError({ provider: "openai", status: 400, message: "Invalid signature in thinking block" })).toBe(false);
    expect(isAnthropicThinkingSignatureError({ provider: "claude", status: 400, message: "latest assistant message cannot be modified" })).toBe(false);
  });
});

describe("OmniRoute #7906 — historical thinking strip preserves the active tool cycle", () => {
  const thinking = { type: "thinking", thinking: "t", signature: "sig" };
  const text = { type: "text", text: "hi" };
  const toolUse = { type: "tool_use", id: "tu1", name: "read", input: {} };
  const toolResult = { type: "tool_result", tool_use_id: "tu1", content: "ok" };

  it("strips thinking from a completed historical assistant turn", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [thinking, text] },
        { role: "user", content: [{ type: "text", text: "q2" }] },
        { role: "assistant", content: [text] },
      ],
    };
    const out = stripHistoricalThinkingForSignatureRecovery(body);
    expect(out).not.toBe(body);
    expect(out.messages[1].content.some((b) => b.type === "thinking")).toBe(false);
    expect(out.messages[1].content.some((b) => b.type === "text")).toBe(true);
  });

  it("preserves thinking in the active (trailing) tool-use/result cycle", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [thinking, toolUse] },
        { role: "user", content: [toolResult] },
      ],
    };
    const out = stripHistoricalThinkingForSignatureRecovery(body);
    // The assistant tool_use turn is the active cycle -> thinking kept.
    expect(out.messages[1].content.some((b) => b.type === "thinking")).toBe(true);
  });

  it("returns the same body reference when nothing changed", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "q" }] }] };
    expect(stripHistoricalThinkingForSignatureRecovery(body)).toBe(body);
  });
});
