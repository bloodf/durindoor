import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const translate = (messages, extra = {}) => openaiToClaudeRequest(
  "claude-model",
  { messages, ...extra },
  true
);

describe("OmniRoute #14814 Claude function history tool input shape", () => {
  it("preserves object arguments and normalizes non-object or invalid arguments to empty objects", () => {
    const argumentsList = [
      ['{"query":"weather"}', { query: "weather" }],
      ["\"scalar\"", {}],
      ["42", {}],
      ["true", {}],
      ["[1,2]", {}],
      ["null", {}],
      ["{invalid", {}],
    ];
    const messages = argumentsList.map(([args], index) => ({
      role: "assistant",
      tool_calls: [{
        id: `call-${index}`,
        type: "function",
        function: { name: "lookup", arguments: args },
      }],
    }));

    const out = translate(messages);
    const blocks = out.messages.flatMap((message) => message.content)
      .filter((block) => block.type === "tool_use");

    expect(blocks.map(({ id, name, input }) => ({ id, name, input }))).toEqual(
      argumentsList.map(([, input], index) => ({ id: `call-${index}`, name: "lookup", input }))
    );
  });

  it("preserves native typed tool inputs and thinking blocks", () => {
    const nativeInput = { nested: [1, "two"] };
    const out = translate([{
      role: "assistant",
      reasoning_content: "thinking",
      content: [{ type: "tool_use", id: "native-call", name: "native", input: nativeInput }],
      tool_calls: [{ id: "function-call", type: "function", function: { name: "lookup", arguments: '{"ok":true}' } }],
    }]);
    const blocks = out.messages.flatMap((message) => message.content);

    expect(blocks).toContainEqual({ type: "thinking", thinking: "thinking" });
    expect(blocks).toContainEqual({ type: "tool_use", id: "native-call", name: "native", input: nativeInput });
    expect(blocks).toContainEqual(expect.objectContaining({
      type: "tool_use", id: "function-call", name: "lookup", input: { ok: true },
    }));
  });

  it("leaves structured custom text, tool declarations, and calls without a type unchanged", () => {
    const out = translate([{
      role: "assistant",
      content: [{ type: "text", text: "custom" }],
      tool_calls: [
        { id: "typed-call", type: "function", function: { name: "typed", arguments: '{"a":1}' } },
        { id: "missing-type", function: { name: "ignored", arguments: '{"b":2}' } },
      ],
    }], {
      tools: [{ type: "function", function: { name: "typed", parameters: { type: "object" } } }],
    });
    const blocks = out.messages.flatMap((message) => message.content);

    expect(out.tools[0]).toMatchObject({ name: "typed", input_schema: { type: "object" } });
    expect(blocks).toContainEqual({ type: "text", text: "custom" });
    expect(blocks.filter((block) => block.type === "tool_use")).toHaveLength(1);
    expect(blocks).toContainEqual(expect.objectContaining({
      type: "tool_use", id: "typed-call", name: "typed", input: { a: 1 },
    }));
  });
});
