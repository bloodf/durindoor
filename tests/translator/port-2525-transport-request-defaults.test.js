// Regression tests for upstream decolua/9router PR #2525
// (head 72385571c6): per-transport requestDefaults (MiniMax openai
// transport → reasoning_split) applied through translateRequest.

import "./registerAll.js";
import { describe, it, expect } from "vitest";
import { applyTransportRequestDefaults } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const defaults = (targetFormat, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyTransportRequestDefaults(targetFormat, b, provider);
  return b;
};

describe("port-2525 applyTransportRequestDefaults", () => {
  it("applies openai transport requestDefaults for MiniMax", () => {
    const out = defaults("openai", { messages: [{ role: "user", content: "hi" }] }, "minimax");
    expect(out.reasoning_split).toBe(true);
  });

  it("applies openai transport requestDefaults for MiniMax CN", () => {
    const out = defaults("openai", { messages: [{ role: "user", content: "hi" }] }, "minimax-cn");
    expect(out.reasoning_split).toBe(true);
  });

  it("skips defaults for non-matching transport format", () => {
    const out = defaults("claude", { messages: [{ role: "user", content: "hi" }] }, "minimax");
    expect(out.reasoning_split).toBeUndefined();
  });

  it("respects explicit client override", () => {
    const out = defaults("openai", { reasoning_split: false, messages: [] }, "minimax");
    expect(out.reasoning_split).toBe(false);
  });

  it("no-ops for providers without requestDefaults", () => {
    const out = defaults("openai", { messages: [] }, "openai");
    expect(out).toEqual({ messages: [] });
  });
});

describe("port-2525 translateRequest applies transport defaults", () => {
  it("adds reasoning_split when translating toward MiniMax openai transport", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const result = translateRequest("openai", "openai", "MiniMax-M3", body, true, null, "minimax");
    expect(result.reasoning_split).toBe(true);
  });

  it("does not add reasoning_split on the Claude transport", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      system: [{ type: "text", text: "sys" }],
      max_tokens: 1024,
    };
    const result = translateRequest("claude", "claude", "MiniMax-M3", body, true, null, "minimax");
    expect(result.reasoning_split).toBeUndefined();
  });
});
