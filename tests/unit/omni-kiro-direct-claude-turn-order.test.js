import { describe, expect, it } from "vitest";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const model = "claude-sonnet-4.6";
const tools = [{ name: "read_file", input_schema: { type: "object", properties: {} } }];
const convert = (messages) => claudeToKiroRequest(model, { messages, tools }, true, {}).conversationState;
const count = (value, text) => JSON.stringify(value).split(text).length - 1;

describe("direct Claude to Kiro turn ownership", () => {
  it("keeps assistant-ended turns in order and continues with declared tools", () => {
    const state = convert([
      { role: "user", content: "First question" },
      { role: "assistant", content: "Previous answer" },
    ]);
    expect(state.history).toEqual([
      { userInputMessage: { content: "First question", modelId: model } },
      { assistantResponseMessage: { content: "Previous answer" } },
    ]);
    const current = state.currentMessage.userInputMessage;
    expect(current.content).toMatch(/^\[Context: Current time is .*Z\]\n\nContinue$/);
    expect(current.userInputMessageContext.tools).toHaveLength(1);
    expect(current.userInputMessageContext.tools[0].toolSpecification.name).toBe("read_file");
    expect(count(state, "First question")).toBe(1);
    expect(count(state, "toolSpecification")).toBe(1);
  });

  it("keeps a final tool result in current context without duplicating it", () => {
    const state = convert([
      { role: "user", content: "Read it" },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file contents" }] },
    ]);
    expect(state.history[0].userInputMessage.content).toBe("Read it");
    expect(state.history[1].assistantResponseMessage.toolUses[0].toolUseId).toBe("call_1");
    const current = state.currentMessage.userInputMessage;
    expect(current.content).toMatch(/^\[Context: Current time is .*Z\]\n\n$/);
    expect(current.userInputMessageContext.toolResults).toEqual([
      { toolUseId: "call_1", status: "success", content: [{ text: "file contents" }] },
    ]);
    expect(current.userInputMessageContext.tools).toHaveLength(1);
    expect(count(state, "file contents")).toBe(1);
  });

  it("keeps a completed tool exchange in assistant-ended history", () => {
    const state = convert([
      { role: "user", content: "Read it" },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file contents" }] },
      { role: "assistant", content: "Done" },
    ]);
    expect(state.history.map((turn) => turn.userInputMessage ? "user" : "assistant"))
      .toEqual(["user", "assistant", "user", "assistant"]);
    expect(state.history[2].userInputMessage.userInputMessageContext.toolResults[0].toolUseId).toBe("call_1");
    expect(state.currentMessage.userInputMessage.content).toMatch(/\n\nContinue$/);
    expect(state.currentMessage.userInputMessage.userInputMessageContext.tools).toHaveLength(1);
    expect(count(state, "file contents")).toBe(1);
  });

  it("uses a final text user turn as current", () => {
    const state = convert([
      { role: "user", content: "First question" },
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "Follow up" },
    ]);
    expect(state.history).toHaveLength(2);
    expect(state.currentMessage.userInputMessage.content).toMatch(/\n\nFollow up$/);
    expect(count(state, "First question")).toBe(1);
    expect(count(state, "Follow up")).toBe(1);
    expect(state.currentMessage.userInputMessage.userInputMessageContext.tools).toHaveLength(1);
  });
});
