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

      const body = { reasoning_effort: "xhigh" };
      applyThinking("openai", model, body, "deepseek");
      expect(body.reasoning_effort, model).toBe("max");
    }
  });

  it("keeps older and routed DeepSeek models on the legacy high tier", () => {
    for (const [provider, model] of [
      ["deepseek", "deepseek-reasoner"],
      ["openrouter", "deepseek-v4-pro"],
      ["tllm", "deepseek_v4"],
    ]) {
      expect(getThinkingLevels(provider, model), `${provider}/${model}`).not.toContain("max");

      const body = { reasoning_effort: "xhigh" };
      applyThinking("openai", model, body, provider);
      expect(body.reasoning_effort, `${provider}/${model}`).toBe("high");
    }
  });
});
