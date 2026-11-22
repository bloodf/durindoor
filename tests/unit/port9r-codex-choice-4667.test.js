import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Codex forced function choice", () => {
  it("retains a declared function selected with the Chat Completions shape", () => {
    const body = { input: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }], tool_choice: { type: "function", function: { name: "lookup" } } };
    const result = new CodexExecutor().transformRequest("gpt-5", body, true, {});
    expect(result.tool_choice).toEqual({ type: "function", name: "lookup" });
  });
  it("inlines references in native Antigravity response schemas", () => {
    const request = { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { responseSchema: { type: "object", properties: { answer: { $ref: "#/$defs/answer" } }, $defs: { answer: { type: "string" } } } } };
    const result = new AntigravityExecutor().transformRequest("gemini-3.1-pro-high", { request }, true, {});
    expect(result.request.generationConfig.responseSchema.properties.answer).toEqual({ type: "string" });
  });
});
