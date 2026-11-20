import { describe, expect, it } from "vitest";
import { completionToStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";

describe("JSON completions on a streaming path", () => {
  it("frames choices, tool calls, finish reasons and usage", () => {
    const input = { choices: [{ index: 0, message: { role: "assistant", content: "hello", tool_calls: [{ id: "call-1", type: "function", function: { name: "f", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { completion_tokens: 4 } };
    const stream = completionToStream(input);
    const chunk = JSON.parse(stream.split("\n")[0].slice(6));
    expect(chunk.choices[0].delta.content).toBe("hello");
    expect(chunk.choices[0].delta.tool_calls[0].index).toBe(0);
    expect(chunk.choices[0].finish_reason).toBe("tool_calls");
    expect(chunk.usage).toEqual(input.usage);
    expect(stream).toContain("[DONE]");
  });
  it("rejects errors and malformed responses", () => {
    expect(() => completionToStream({ error: { message: "bad" } })).toThrow();
    expect(() => completionToStream({ choices: [{ delta: {} }] })).toThrow();
  });
});
