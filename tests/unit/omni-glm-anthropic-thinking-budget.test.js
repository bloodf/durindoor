import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { reconcileClaudeThinkingBudget } from "../../open-sse/translator/formats/claude.js";
import { LEVEL_TO_BUDGET } from "../../open-sse/translator/concerns/thinking.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const messages = [{ role: "user", content: "hi" }];
const toClaude = (source, provider, model, body) =>
  translateRequest(source, "claude", model, structuredClone({ model, messages, ...body }), true, null, provider);

// Anthropic contract enforced by Z.ai's /api/anthropic endpoint.
const expectValid = (out) => {
  if (out.thinking?.type !== "enabled") return;
  expect(Number.isInteger(out.thinking.budget_tokens)).toBe(true);
  expect(out.thinking.budget_tokens).toBeGreaterThanOrEqual(LEVEL_TO_BUDGET.low);
  expect(out.max_tokens).toBeGreaterThan(out.thinking.budget_tokens);
};

// glm-4.6 can disable thinking, so it carries an explicit enabled block.
const TOGGLE = ["glm-4.6", "glm-4.5-air", "glm-4.7-flashx"];

describe("GLM Anthropic endpoint thinking budget", () => {
  for (const provider of ["glm", "zai"]) {
    describe(provider, () => {
      it.each(TOGGLE)("adds the local level budget to translated effort on %s", (model) => {
        const high = toClaude("openai", provider, model, { reasoning_effort: "high" });
        expect(high.thinking).toEqual({ type: "enabled", budget_tokens: LEVEL_TO_BUDGET.high });
        expectValid(high);
        const max = toClaude("openai", provider, model, { reasoning_effort: "max" });
        expect(max.thinking.budget_tokens).toBe(max.max_tokens - 1024);
        expectValid(max);
      });

      it("clamps a derived budget to max_tokens and keeps the caller's output cap", () => {
        const out = toClaude("openai", provider, "glm-4.6", { reasoning_effort: "high", max_tokens: 4096 });
        expect(out.max_tokens).toBe(4096);
        expect(out.thinking.budget_tokens).toBe(3072);
        expectValid(out);
      });

      it("never exceeds the model output ceiling", () => {
        const ceiling = getCapabilitiesForModel(provider, "glm-4.6").maxOutput;
        const out = toClaude("openai", provider, "glm-4.6", { reasoning_effort: "max", max_tokens: ceiling * 2 });
        expect(out.max_tokens).toBeLessThanOrEqual(ceiling);
        expectValid(out);
      });

      it("drops thinking rather than sending an invalid block when max_tokens cannot hold a budget", () => {
        const out = toClaude("openai", provider, "glm-4.6", { reasoning_effort: "high", max_tokens: 1500 });
        expect(out.thinking).toBeUndefined();
        expect(out.max_tokens).toBe(1500);
      });

      it("fills the missing budget of a native enabled block", () => {
        const out = toClaude("claude", provider, "glm-4.6", { max_tokens: 8192, thinking: { type: "enabled" } });
        expect(out.thinking.type).toBe("enabled");
        expectValid(out);
      });

      it("keeps a valid explicit native budget", () => {
        const out = toClaude("claude", provider, "glm-4.6", { max_tokens: 8192, thinking: { type: "enabled", budget_tokens: 2048 } });
        expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
        expect(out.max_tokens).toBe(8192);
      });

      it("keeps an explicit budget on an always-on model, where the marker was previously dropped", () => {
        const out = toClaude("claude", provider, "glm-5.2", { max_tokens: 8192, thinking: { type: "enabled", budget_tokens: 2048 } });
        expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
        expectValid(out);
      });

      it("still omits the redundant marker on an always-on model without a budget", () => {
        for (const seed of [{ reasoning_effort: "high" }, { thinking: { type: "enabled" } }]) {
          const out = toClaude(seed.thinking ? "claude" : "openai", provider, "glm-5.2", { max_tokens: 8192, ...seed });
          expect(out.thinking).toBeUndefined();
          expect(out.reasoning_effort).toBe("high");
        }
      });

      it("raises max_tokens for an explicit budget that does not fit, within the ceiling", () => {
        const out = toClaude("claude", provider, "glm-4.6", { max_tokens: 4096, thinking: { type: "enabled", budget_tokens: 8000 } });
        expect(out.thinking.budget_tokens).toBe(8000);
        expect(out.max_tokens).toBe(9024);
        expectValid(out);
      });

      it("lifts a below-minimum explicit budget to the lowest level budget", () => {
        const out = toClaude("claude", provider, "glm-4.6", { max_tokens: 8192, thinking: { type: "enabled", budget_tokens: 512 } });
        expect(out.thinking.budget_tokens).toBe(LEVEL_TO_BUDGET.low);
        expectValid(out);
      });

      it("keeps disabled handling: no thinking block, native disable flag", () => {
        for (const [source, seed] of [["openai", { reasoning_effort: "none" }], ["claude", { thinking: { type: "disabled" } }]]) {
          const out = toClaude(source, provider, "glm-4.6", { max_tokens: 8192, ...seed });
          expect(out.thinking).toBeUndefined();
          expect(out.enable_thinking).toBe(false);
        }
      });
    });
  }

  it("does not alter the same shapes for other providers", () => {
    // Reconciliation is scoped to the GLM Anthropic providers.
    const other = { model: "glm-4.6", max_tokens: 4096, thinking: { type: "enabled" } };
    expect(reconcileClaudeThinkingBudget(structuredClone(other), "anthropic").thinking).toEqual({ type: "enabled" });
    // The explicit budget is carried only for the GLM Anthropic providers.
    const seed = () => ({ thinking: { type: "enabled", budget_tokens: 2048 } });
    expect(applyThinking("claude", "glm-4.6", seed(), "glm-cn").thinking).toEqual({ type: "enabled" });
    expect(applyThinking("claude", "glm-4.6", seed(), "glm").thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("does not alter an adaptive block on a supported adaptive route", () => {
    const body = { model: "claude-opus-4-7", max_tokens: 4096, thinking: { type: "adaptive" } };
    expect(reconcileClaudeThinkingBudget(structuredClone(body), "claude")).toEqual(body);
    expect(reconcileClaudeThinkingBudget(structuredClone(body), "glm")).toEqual(body);
  });

  it("leaves the OpenAI GLM transport unchanged", () => {
    for (const provider of ["glm", "zai"]) {
      const out = translateRequest("openai", "openai", "glm-4.6", structuredClone({ model: "glm-4.6", messages, reasoning_effort: "high", max_tokens: 4096 }), true, null, provider);
      expect(out.thinking).toEqual({ type: "enabled" });
      expect(out.max_tokens).toBe(4096);
    }
    const body = { reasoning_effort: "high" };
    applyThinking("openai", "glm-5.3", body, "glm");
    expect(body.thinking).toEqual({ type: "enabled" });
  });
});
