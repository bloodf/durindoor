import { describe, expect, it } from "vitest";

describe("GithubExecutor custom maxOutput clamp", () => {
  it("clamps the /chat/completions transform body", async () => {
    const { GithubExecutor } = await import("../../open-sse/executors/github.js");
    const ex = new GithubExecutor();
    const out = ex.transformRequest("gpt-5.4", { max_tokens: 9000 }, false, {}, { modelCapabilities: { maxOutput: 2048 } });
    // github's applyParamRenames maps max_tokens -> max_completion_tokens; the
    // clamp runs after the rename on the final field.
    expect(out.max_completion_tokens).toBe(2048);
    expect(out.max_tokens).toBeUndefined();
  });

  it("does not invent token fields when absent", async () => {
    const { GithubExecutor } = await import("../../open-sse/executors/github.js");
    const ex = new GithubExecutor();
    const out = ex.transformRequest("gpt-5.4", { messages: [] }, false, {}, { modelCapabilities: { maxOutput: 2048 } });
    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBeUndefined();
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
