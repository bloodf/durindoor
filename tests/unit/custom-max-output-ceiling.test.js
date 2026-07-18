import { describe, expect, it } from "vitest";
import { reconcileClaudeThinkingBudget } from "../../open-sse/translator/formats/claude.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { buildCustomCapabilities } from "../../src/app/(dashboard)/dashboard/providers/[id]/customModelCapabilities.js";

describe("custom maxOutput ceiling", () => {
  it("clamps max_tokens to the custom ceiling in reconcileClaudeThinkingBudget", () => {
    const body = { model: "my-custom", max_tokens: 8192 };
    reconcileClaudeThinkingBudget(body, "claude", 1024);
    expect(body.max_tokens).toBe(1024);
  });

  it("fits the thinking budget inside the custom ceiling, never above it", () => {
    const body = {
      model: "my-custom",
      max_tokens: 900,
      thinking: { type: "enabled", budget_tokens: 2000 },
    };
    reconcileClaudeThinkingBudget(body, "claude", 1024);
    expect(body.max_tokens).toBeLessThanOrEqual(1024);
    expect(body.thinking.budget_tokens).toBeLessThan(body.max_tokens);
  });

  it("keeps a roomy ceiling's budget fit unchanged", () => {
    const body = {
      model: "my-custom",
      max_tokens: 3000,
      thinking: { type: "enabled", budget_tokens: 8000 },
    };
    reconcileClaudeThinkingBudget(body, "claude", 65536);
    expect(body.max_tokens).toBe(8000 + 1024);
    expect(body.thinking.budget_tokens).toBe(8000);
  });

  it("falls back to static catalog ceiling when no custom override", () => {
    const body = { model: "claude-sonnet-4-5", max_tokens: 999999 };
    reconcileClaudeThinkingBudget(body, "claude", null);
    expect(body.max_tokens).toBeLessThan(999999);
  });

  it("openaiToClaudeRequest caps max_tokens at translationContext.modelCapabilities.maxOutput", () => {
    const out = openaiToClaudeRequest(
      "my-custom",
      { max_tokens: 8192, messages: [{ role: "user", content: "hi" }] },
      false,
      null,
      { modelCapabilities: { maxOutput: 1024 } },
    );
    expect(out.max_tokens).toBe(1024);
  });
});

describe("buildCustomCapabilities thinkingCanDisable", () => {
  it("omits thinkingCanDisable when undefined (untouched)", () => {
    const caps = buildCustomCapabilities({ booleanCaps: { tools: true }, thinkingCanDisable: undefined });
    expect(Object.hasOwn(caps, "thinkingCanDisable")).toBe(false);
  });

  it("persists explicit false", () => {
    const caps = buildCustomCapabilities({ booleanCaps: {}, thinkingCanDisable: false });
    expect(caps.thinkingCanDisable).toBe(false);
  });
});
