import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../open-sse/handlers/countTokensCore.js";

describe("estimateTokens", () => {
  it("estimates string-only body unchanged", () => {
    const body = { messages: [{ role: "user", content: "Hello world" }] };
    expect(estimateTokens(body)).toBe(Math.ceil(11 / 4));
  });

  it("counts tool_use blocks", () => {
    const withTool = {
      messages: [{
        role: "assistant",
        content: [{ type: "tool_use", name: "search", input: { q: "abc" } }],
      }],
    };
    expect(estimateTokens(withTool)).toBeGreaterThan(estimateTokens({ messages: [] }));
  });

  it("counts tool_result string content", () => {
    const withResult = {
      messages: [{
        role: "user",
        content: [{ type: "tool_result", content: "Result text here" }],
      }],
    };
    expect(estimateTokens(withResult)).toBeGreaterThan(estimateTokens({ messages: [] }));
  });

  it("counts thinking blocks", () => {
    const withThinking = {
      messages: [{
        role: "assistant",
        content: [{ type: "thinking", thinking: "Let me think..." }],
      }],
    };
    expect(estimateTokens(withThinking)).toBe(Math.ceil("Let me think...".length / 4));
  });

  it("counts system array text blocks", () => {
    const body = {
      system: [{ type: "text", text: "System prompt" }],
      messages: [],
    };
    expect(estimateTokens(body)).toBe(Math.ceil("System prompt".length / 4));
  });

  it("counts tools definitions", () => {
    const tools = [{ name: "get_weather", input_schema: { type: "object" } }];
    expect(estimateTokens({ messages: [], tools })).toBeGreaterThan(estimateTokens({ messages: [] }));
  });
});
