import { describe, expect, it, vi } from "vitest";

describe("DefaultExecutor generic custom maxOutput clamp", () => {
  it("clamps max_tokens and max_completion_tokens; never invents fields", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("openai-compatible-abc");
    const body = { max_tokens: 9000, messages: [] };
    const ctx = { modelCapabilities: { maxOutput: 2048 } };
    const out = ex.clampCustomMaxOutput(await ex.transformRequest("custom-x", body, false, {}, ctx), ctx);
    expect(out.max_tokens).toBe(2048);
    expect(out.max_completion_tokens).toBeUndefined();
    const body2 = { max_completion_tokens: 9000, messages: [] };
    const out2 = ex.clampCustomMaxOutput(await ex.transformRequest("custom-x", body2, false, {}, ctx), ctx);
    // applyParamRenames normalizes max_completion_tokens -> max_tokens before the clamp
    expect(out2.max_tokens).toBe(2048);
    expect(out2.max_completion_tokens).toBeUndefined();
  });

  it("leaves values below the ceiling untouched", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const ex = new DefaultExecutor("openai-compatible-abc");
    const body = { max_tokens: 100, messages: [] };
    const ctx = { modelCapabilities: { maxOutput: 2048 } };
    const out = ex.clampCustomMaxOutput(await ex.transformRequest("custom-x", body, false, {}, ctx), ctx);
    expect(out.max_tokens).toBe(100);
  });
});
