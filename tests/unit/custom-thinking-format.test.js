import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

function capsWith(customKeys, extra = {}) {
  const caps = { reasoning: true, thinkingFormat: "claude-budget", ...extra };
  Object.defineProperty(caps, "customKeys", { value: new Set(customKeys), enumerable: false });
  return caps;
}

describe("custom thinkingFormat precedence", () => {
  it("explicit custom thinkingFormat outranks the provider registry default", () => {
    const body = { reasoning_effort: "high", messages: [] };
    // openrouter registry thinkingFormat is openai; custom row says claude
    applyThinking("openai", "custom-x", body, "openrouter", { mode: "level", level: "high" }, capsWith(["thinkingFormat"]));
    // claude-budget format emits a thinking block, not reasoning_effort
    expect(body.thinking).toMatchObject({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("inherited (non-custom) format keeps provider default", () => {
    const body = { reasoning_effort: "high", messages: [] };
    applyThinking("openai", "custom-x", body, "openrouter", { mode: "level", level: "high" }, capsWith([]));
    expect(body.thinking).toBeUndefined();
  });
});
