import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { applyDeepSeekV4ProAlias, injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

const messages = [{ role: "assistant", content: "answer" }];

describe("DeepSeek thinking suffixes", () => {
  it.each(["low", "medium", "high", "max"])("maps %s for a registered model", (effort) => {
    const out = injectReasoningContent({ provider: "deepseek", model: `deepseek-flash-${effort}`, body: { messages } });
    expect(out).toMatchObject({ model: "deepseek-flash", reasoning_effort: effort, extra_body: { thinking: { type: "enabled" } }, messages: [{ reasoning_content: " " }] });
  });
  it("preserves real catalog names and unknown models", () => {
    for (const model of ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-r1-max"]) {
      const body = { model, messages };
      expect(applyDeepSeekV4ProAlias({ provider: "deepseek", model, body })).toBe(body);
    }
  });
  it("uses the wire model and skips history injection for disabled thinking", () => {
    const out = injectReasoningContent({ provider: "deepseek", model: "deepseek-v4-flash-none", body: { messages, reasoning_effort: "high" } });
    expect(out).toMatchObject({ model: "deepseek-flash", extra_body: { thinking: { type: "disabled" } }, messages });
    expect(out.reasoning_effort).toBeUndefined();
  });
  it("sets Claude thinking and effort on the native transport", () => {
    const out = new DefaultExecutor("deepseek").transformRequest("deepseek-flash", { model: "deepseek-flash", messages }, false, { runtimeTransport: { format: "claude" } }, { catalogModel: "deepseek-flash-high" });
    expect(out).toMatchObject({ model: "deepseek-flash", thinking: { type: "enabled" }, output_config: { effort: "high" }, messages });
    expect(out.extra_body).toBeUndefined();
  });
});
