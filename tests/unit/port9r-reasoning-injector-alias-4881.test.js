// Port of decolua/9router#4881: the reasoning-content injector must not add a
// second carrier when the assistant turn already has `reasoning` / array content.
import { describe, expect, it } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

const call = { id: "c1", type: "function", function: { name: "f", arguments: "{}" } };
const run = (assistant) => injectReasoningContent({
  provider: "opencode",
  model: "deepseek-v4-flash-free",
  body: { messages: [{ role: "user", content: "hi" }, assistant] },
}).messages[1];

describe("injectReasoningContent idempotence across alias carriers (#4881)", () => {
  it("keeps reasoning_content untouched when reasoning alias also present", () => {
    const out = run({ role: "assistant", content: null, tool_calls: [call], reasoning: "chain", reasoning_content: "echo" });
    expect(out.reasoning_content).toBe("echo");
    expect(out.reasoning).toBe("chain");
  });

  it("does not inject when only the reasoning alias is present", () => {
    const out = run({ role: "assistant", content: null, tool_calls: [call], reasoning: "chain" });
    expect(out.reasoning).toBe("chain");
    expect(out.reasoning_content).toBeUndefined();
  });

  it("does not inject over a non-empty array reasoning carrier", () => {
    const out = run({ role: "assistant", content: null, tool_calls: [call], reasoning: [{ type: "text", text: "x" }] });
    expect(out.reasoning_content).toBeUndefined();
  });

  it("still injects a placeholder when no carrier exists", () => {
    expect(run({ role: "assistant", content: null, tool_calls: [call] }).reasoning_content).toBeDefined();
  });
});
