import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

// GLM-5.3 and GLM-5.3-Flash always reason (z.ai: thinking cannot be disabled),
// so the enable marker is redundant. On the Anthropic wire a `thinking` block
// without budget_tokens is rejected outright, so the marker must be omitted
// there while the reasoning effort is preserved.
describe("GLM always-on reasoning on the Anthropic wire", () => {
  it.each([
    [{ reasoning_effort: "high" }, "high"],
    [{ thinking: { type: "enabled" } }, "high"],
    [{ reasoning_effort: "none" }, "high"],
  ])("omits the redundant thinking block for intent %j", (seed, effort) => {
    for (const model of ["glm-5.3", "glm-5.3-flash"]) {
      const body = structuredClone(seed);

      applyThinking("claude", model, body, "glm");

      expect(body.thinking).toBeUndefined();
      expect(body.enable_thinking).toBeUndefined();
      expect(body.reasoning_effort).toBe(effort);
    }
  });

  it("keeps the enable/disable controls for a GLM model that can disable thinking", () => {
    const enabled = { reasoning_effort: "high" };
    applyThinking("claude", "glm-4.6v", enabled, "glm");
    expect(enabled.thinking).toEqual({ type: "enabled" });
    expect(enabled.enable_thinking).toBeUndefined();

    const disabled = { reasoning_effort: "none" };
    applyThinking("claude", "glm-4.6v", disabled, "glm");
    expect(disabled.enable_thinking).toBe(false);
    expect(disabled.thinking).toBeUndefined();
  });

  it("preserves the native Z.ai enable marker on the OpenAI transport", () => {
    const body = { reasoning_effort: "high" };

    applyThinking("openai", "glm-5.3", body, "glm");

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });

  it("preserves the OpenAI aggregator's reasoning format", () => {
    const body = { reasoning_effort: "high" };

    applyThinking("openai", "glm-5.3", body, "openrouter");

    expect(body.reasoning_effort).toBe("high");
    expect(body.thinking).toBeUndefined();
  });
});
