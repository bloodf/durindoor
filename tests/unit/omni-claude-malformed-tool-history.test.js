import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

const schema = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };
const blocks = (out) => out.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []);
const verify = (out) => {
  const all = blocks(out);
  expect(all.filter((b) => b.type === "tool_use").map((b) => [b.id, b.name])).toEqual([["shared", "lookup"]]);
  expect(all.filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content])).toEqual([["shared", "real output"]]);
  expect(all.some((b) => b.type === "text" && b.text === "keep this message")).toBe(true);
  expect(out.tools[0].input_schema).toEqual(schema);
};

describe("Claude malformed tool history", () => {
  it("repairs native history while retaining valid calls and custom schema", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-sonnet-4-6", tools: [{ name: "lookup", input_schema: schema }],
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: [{ type: "tool_use", id: "shared", name: "  ", input: {} }, { type: "tool_use", id: "shared", name: "lookup", input: {} }, { type: "tool_use", id: "bad", name: 42, input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "shared", content: "bad output" }, { type: "tool_result", tool_use_id: "shared", content: "real output" }, { type: "tool_result", tool_use_id: "bad", content: "bad output" }, { type: "text", text: "keep this message" }] },
      ],
    }, "claude-sonnet-4-6", "anthropic");
    verify(out);
  });

  it("repairs translated OpenAI tool calls and native-shaped blocks", () => {
    const out = translateRequest("openai", "claude", "claude-sonnet-4-6", {
      model: "claude-sonnet-4-6", max_tokens: 100,
      tools: [{ type: "function", function: { name: "lookup", parameters: schema } }],
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: [{ type: "tool_use", id: "native", input: {} }], tool_calls: [
          { id: "shared", type: "function", function: { name: " ", arguments: "{}" } },
          { id: "shared", type: "function", function: { name: "lookup", arguments: "{}" } },
          { id: "bad", type: "function", function: { name: 7, arguments: "{}" } },
        ] },
        { role: "tool", tool_call_id: "native", content: "bad output" },
        { role: "tool", tool_call_id: "shared", content: "bad output" },
        { role: "tool", tool_call_id: "shared", content: "real output" },
        { role: "tool", tool_call_id: "bad", content: "bad output" },
        { role: "user", content: "keep this message" },
      ],
    }, true, null, "anthropic");
    verify(out);
  });
});
