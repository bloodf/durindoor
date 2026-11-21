import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];

function translate(result, claude = false, withTools = true) {
  const id = "caller-id";
  const assistant = claude
    ? { role: "assistant", content: [{ type: "tool_use", id, name: "lookup", input: {} }] }
    : { role: "assistant", tool_calls: [{ id, type: "function", function: { name: "lookup", arguments: "{}" } }] };
  const message = claude
    ? { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: result }] }
    : { role: "tool", tool_call_id: id, is_error: true, content: result };
  return openaiToKiroRequest("claude-sonnet-4", {
    messages: [{ role: "user", content: "Start" }, assistant, message],
    tools: withTools ? tools : []
  }, false, null).conversationState;
}

describe.each([false, true])("Kiro tool results (Claude blocks: %s)", (claude) => {
  it("preserves text and structured content without exposing image payloads", () => {
    const state = translate([
      { type: "text", text: "Found:" },
      { type: "json", data: { count: 2 } },
      { type: "image", source: { media_type: "image/png", data: "secret-bytes" } },
      { type: "image_url", image_url: { url: "https://example.test/secret" } }
    ], claude);
    const result = state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0];
    expect(result).toEqual({ toolUseId: "caller-id", status: "error", content: [{ text: 'Found:\n{"type":"json","data":{"count":2}}\n[image: image/png]\n[image: image]' }] });
    expect(JSON.stringify(state)).not.toContain("secret-bytes");
    expect(JSON.stringify(state)).not.toContain("https://example.test/secret");
    expect(state.history.at(-1).assistantResponseMessage.toolUses[0].toolUseId).toBe("caller-id");
  });

  it("keeps existing strings and empty results", () => {
    for (const content of ["plain output", "", null, []]) {
      const state = translate(content, claude);
      expect(state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content)
        .toEqual([{ text: content === "plain output" ? content : "" }]);
    }
  });

  it("ignores nested lists between supported blocks", () => {
    const state = translate([
      { type: "text", text: "Before" },
      [{ type: "text", text: "Unsupported" }],
      { type: "text", text: "After" }
    ], claude);
    expect(state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0])
      .toEqual({ toolUseId: "caller-id", status: "error", content: [{ text: "Before\nAfter" }] });
  });

  it("preserves result content when tools are absent", () => {
    const state = translate([{ type: "json", data: { count: 2 } }], claude, false);
    expect(state.currentMessage.userInputMessage.content).toContain('[Tool error: {"type":"json","data":{"count":2}}]');
  });
});
