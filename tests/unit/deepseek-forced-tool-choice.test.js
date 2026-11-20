import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("DeepSeek V4 tool choice", () => {
  const run = (provider, model, fields) => new DefaultExecutor(provider).transformRequest(
    model, { ...fields }, true, { runtimeTransport: { format: FORMATS.OPENAI } }
  );
  it("drops forced choices only when native V4 thinking is active", () => {
    for (const choice of ["required", { type: "function", function: { name: "lookup" } }]) {
      expect(run("deepseek", "deepseek-v4-pro", { tool_choice: choice }).tool_choice).toBeUndefined();
      expect(run("deepseek", "deepseek-flash", { tool_choice: choice, thinking: { type: "disabled" } }).tool_choice).toEqual(choice);
      expect(run("deepseek", "deepseek-v4-pro", { tool_choice: choice, reasoning_effort: "none" }).tool_choice).toEqual(choice);
      expect(run("deepseek", "deepseek-v4-pro", { tool_choice: choice, thinking: { type: "enabled" }, reasoning_effort: "none" }).tool_choice).toBeUndefined();
      expect(run("openrouter", "deepseek-v4-pro", { tool_choice: choice }).tool_choice).toEqual(choice);
    }
    expect(run("deepseek", "deepseek-v4-pro", { tool_choice: "auto" }).tool_choice).toBe("auto");
  });
});
