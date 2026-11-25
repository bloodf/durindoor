import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { LEVEL_TO_BUDGET } from "../../open-sse/translator/concerns/thinking.js";

const messages = [{ role: "user", content: "hi" }];
const toClaude = (provider, model, body, source = "openai") =>
  translateRequest(source, "claude", model, structuredClone({ model, messages, ...body }), true, null, provider);

// The glm/zai providers keep their max_tokens-aware budget, covered by
// omni-glm-anthropic-thinking-budget.test.js. These are the other Claude-wire routes.
describe("port(upstream) #4877: zai thinking carries budget_tokens on the Claude wire", () => {
  it.each([
    ["anthropic-compatible-test", "glm-4.6"],
    ["wafer", "GLM-5.1"],
  ])("budgets the enabled block for %s/%s", (provider, model) => {
    const out = toClaude(provider, model, { reasoning_effort: "medium", max_tokens: 16000 });
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: LEVEL_TO_BUDGET.medium });
    expect(out.max_tokens).toBeGreaterThan(out.thinking.budget_tokens);
  });

  it("keeps max_tokens above a budget larger than the caller's cap", () => {
    const out = toClaude("anthropic-compatible-test", "glm-4.6", { reasoning_effort: "high", max_tokens: 4096 });
    expect(out.thinking.budget_tokens).toBeGreaterThanOrEqual(LEVEL_TO_BUDGET.low);
    expect(out.max_tokens).toBeGreaterThan(out.thinking.budget_tokens);
  });

  it("keeps a client's explicit budget and lifts one below the minimum", () => {
    const explicit = toClaude("anthropic-compatible-test", "glm-4.6",
      { max_tokens: 8192, thinking: { type: "enabled", budget_tokens: 2048 } }, "claude");
    expect(explicit.thinking.budget_tokens).toBe(2048);
    const small = applyThinking("claude", "glm-4.6",
      { thinking: { type: "enabled", budget_tokens: 100 } }, "anthropic-compatible-test");
    expect(small.thinking.budget_tokens).toBe(LEVEL_TO_BUDGET.low);
  });

  it("uses the medium budget when the intent names no size", () => {
    const body = applyThinking("claude", "glm-4.6", { reasoning_effort: "auto" }, "anthropic-compatible-test");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: LEVEL_TO_BUDGET.medium });
  });

  it("leaves the OpenAI wire with the bare marker", () => {
    const body = applyThinking("openai", "glm-4.6", { reasoning_effort: "high" }, "glm");
    expect(body.thinking).toEqual({ type: "enabled" });
  });
});
