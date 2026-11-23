import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transform(model, options = {}) {
  return new CodexExecutor().transformRequest(model, { input: "hello", ...options }, true, {});
}

describe("Codex reasoning default", () => {
  it.each(["gpt-5.4", "gpt-5.3-codex", "gpt-6.1-terra"])("defaults %s to medium", (model) => {
    expect(transform(model).reasoning.effort).toBe("medium");
  });

  it("preserves explicit and model-suffix precedence", () => {
    expect(transform("gpt-5.4-high").reasoning.effort).toBe("high");
    expect(transform("gpt-5.4-high", { reasoning_effort: "low" }).reasoning.effort).toBe("low");
    expect(transform("gpt-5.4-high", { reasoning: { effort: "medium" }, reasoning_effort: "low" }).reasoning.effort).toBe("medium");
  });
});
