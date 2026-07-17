import { describe, expect, it } from "vitest";

describe("central custom maxOutput clamp (base execute seam)", () => {
  it("clamps the github /chat/completions transform output like execute() does", async () => {
    const { GithubExecutor } = await import("../../open-sse/executors/github.js");
    const ex = new GithubExecutor();
    const ctx = { modelCapabilities: { maxOutput: 2048 } };
    // execute() composes transformRequest + clampCustomMaxOutput centrally.
    const out = ex.clampCustomMaxOutput(ex.transformRequest("gpt-5.4", { max_tokens: 9000 }, false, {}, ctx), ctx);
    // github's applyParamRenames maps max_tokens -> max_completion_tokens; the
    // clamp then caps the renamed (final) field.
    expect(out.max_completion_tokens).toBe(2048);
    expect(out.max_tokens).toBeUndefined();
  });

  it("does not invent token fields when absent", async () => {
    const { GithubExecutor } = await import("../../open-sse/executors/github.js");
    const ex = new GithubExecutor();
    const ctx = { modelCapabilities: { maxOutput: 2048 } };
    const out = ex.clampCustomMaxOutput(ex.transformRequest("gpt-5.4", { messages: [] }, false, {}, ctx), ctx);
    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("clamps gemini-envelope bodies (antigravity request.generationConfig)", async () => {
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const ex = new BaseExecutor("antigravity");
    const body = { request: { generationConfig: { maxOutputTokens: 8192 } } };
    ex.clampCustomMaxOutput(body, { modelCapabilities: { maxOutput: 1024 } });
    expect(body.request.generationConfig.maxOutputTokens).toBe(1024);
  });

});

describe("modal boolean caps presence semantics", () => {
  it("buildCustomCapabilities passes through only provided boolean keys", async () => {
    const { buildCustomCapabilities } = await import("../../src/app/(dashboard)/dashboard/providers/[id]/customModelCapabilities.js");
    // untouched tools filtered out by the modal before this call
    const caps = buildCustomCapabilities({ booleanCaps: { vision: true } });
    expect(Object.hasOwn(caps, "tools")).toBe(false);
    expect(caps.vision).toBe(true);
  });
});
