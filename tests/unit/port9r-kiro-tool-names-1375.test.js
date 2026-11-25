import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { kiroToOpenAIResponse } from "../../open-sse/translator/response/kiro-to-openai.js";
import { kiroToClaudeResponse } from "../../open-sse/translator/response/kiro-to-claude.js";

const names = ["x".repeat(80) + "a", "x".repeat(80) + "b", "a.b", "a_b"];
const schema = { type: "object", properties: { value: { type: "string" } }, required: ["value"] };

describe("Kiro tool names", () => {
  it.each(["openai", "claude"])("preserves unique names, history and streaming responses for %s", (format) => {
    const tools = names.map((name) => format === "openai" ? { type: "function", function: { name, parameters: schema } } : { name, input_schema: schema });
    const messages = format === "openai" ? [
      { role: "user", content: "hello" },
      { role: "assistant", tool_calls: names.map((name, i) => ({ id: `id${i}`, type: "function", function: { name, arguments: "{}" } })) },
      { role: "user", content: "next" },
    ] : [
      { role: "user", content: "hello" },
      { role: "assistant", content: names.map((name, i) => ({ type: "tool_use", id: `id${i}`, name, input: {} })) },
      { role: "user", content: "next" },
    ];
    const translate = format === "openai" ? openaiToKiroRequest : claudeToKiroRequest;
    const payload = translate("claude-sonnet-4", { messages, tools }, true, {});
    const specs = payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools;
    const wireNames = specs.map((t) => t.toolSpecification.name);
    expect(new Set(wireNames).size).toBe(names.length);
    expect(wireNames.every((name) => name.length <= 64)).toBe(true);
    expect(specs[0].toolSpecification.inputSchema.json.properties.value.type).toBe("string");
    const uses = payload.conversationState.history.flatMap((h) => h.assistantResponseMessage?.toolUses || []);
    expect(uses.map((u) => u.name)).toEqual(wireNames);
    const chunk = { object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: wireNames[0], arguments: "{}" } }] } }] };
    const state = { toolNameMap: payload._toolNameMap };
    if (format === "openai") {
      expect(kiroToOpenAIResponse(chunk, state).choices[0].delta.tool_calls[0].function.name).toBe(names[0]);
    } else {
      expect(kiroToClaudeResponse(chunk, state).find((event) => event.content_block?.type === "tool_use").content_block.name).toBe(names[0]);
    }
  });
});
