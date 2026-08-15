import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("DeepSeek V4 native reasoning effort", () => {
  it("advertises and sends max only for native DeepSeek V4 models", () => {
    for (const model of [
      "deepseek-v4-pro",
      "deepseek-v4-pro-max",
      "deepseek-v4-pro-none",
      "deepseek-v4-flash",
    ]) {
      expect(getThinkingLevels("deepseek", model), model).toContain("max");

      const body = { reasoning_effort: "max" };
      applyThinking("openai", model, body, "deepseek");
      expect(body.reasoning_effort, model).toBe("max");
    }
  });

  it("never sends max on the wire for non-native DeepSeek routes", () => {
    // Each pair is (provider, model) where the deepseek "max" tier must NOT reach
    // the wire — either because the provider speaks a different native format or
    // because the model is the legacy V3.2 family (which only accepts low/high).
    for (const [provider, model] of [
      ["deepseek", "deepseek-reasoner"],
      ["deepseek", "deepseek-chat"],
      ["openrouter", "deepseek-v4-pro"],
      ["tllm", "deepseek_v4"],
      ["oc", "deepseek-v4-flash-free"],
    ]) {
      const body = { reasoning_effort: "max" };
      applyThinking("openai", model, body, provider);
      expect(body.reasoning_effort, `${provider}/${model}`).not.toBe("max");
    }
  });
});
