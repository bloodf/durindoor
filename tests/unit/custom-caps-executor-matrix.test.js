import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

function capsWith(customKeys, extra = {}) {
  const caps = { reasoning: true, ...extra };
  Object.defineProperty(caps, "customKeys", { value: new Set(customKeys), enumerable: false });
  return caps;
}

describe("native-claude shortcut vs explicit custom thinking overrides", () => {
  it("keeps the compatibility shortcut when no custom thinking keys", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 2048 }, messages: [] };
    applyThinking("claude", "llama3", body, "ollama-local", undefined, capsWith([]));
    // shortcut preserves the client's native Claude thinking untouched
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("honors explicit reasoning:false for a custom model on the claude transport", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 2048 }, messages: [] };
    applyThinking("claude", "custom-x", body, "ollama-local", undefined, capsWith(["reasoning"], { reasoning: false }));
    // explicit override: model cannot reason -> thinking stripped
    expect(body.thinking).toBeUndefined();
  });
});

describe("executor clamp matrix (final body token ceilings)", () => {
  const ctx = { modelCapabilities: { maxOutput: 1024 } };

  it("mimocode clamps before dispatch", async () => {
    const { MimocodeExecutor } = await import("../../open-sse/executors/mimocode.js");
    const ex = new MimocodeExecutor();
    const out = ex.clampCustomMaxOutput(ex.transformRequest("m", { max_tokens: 9000 }, false, {}), ctx);
    expect(out.max_tokens).toBe(1024);
  });

  it("base helper clamps gemini envelopes (vertex/antigravity)", async () => {
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const ex = new BaseExecutor("vertex");
    const body = { generationConfig: { maxOutputTokens: 8192 } };
    ex.clampCustomMaxOutput(body, ctx);
    expect(body.generationConfig.maxOutputTokens).toBe(1024);
  });
});
