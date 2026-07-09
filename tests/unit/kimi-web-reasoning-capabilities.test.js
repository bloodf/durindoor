import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("kimi-web reasoning capabilities", () => {
  it("k2d6-thinking is marked as reasoning and uses openai thinking format", () => {
    const caps = getCapabilitiesForModel("kimi-web", "k2d6-thinking");
    expect(caps).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
    });
  });

  it("k2d6 (non-thinking) is not reasoning", () => {
    const caps = getCapabilitiesForModel("kimi-web", "k2d6");
    expect(caps.reasoning).toBe(false);
  });

  it("applyThinking keeps reasoning_effort: none on k2d6-thinking", () => {
    const body = { model: "k2d6-thinking", messages: [{ role: "user", content: "hi" }], reasoning_effort: "none" };
    const result = applyThinking("openai", "k2d6-thinking", body, "kimi-web");
    expect(result.reasoning_effort).toBe("none");
  });
});
