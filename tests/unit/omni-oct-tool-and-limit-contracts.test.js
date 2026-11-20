import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToOpenAIResponsesRequest, openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const schema = { type: "object", properties: { value: { type: "string" } } };
const chatTool = (strict) => ({ type: "function", function: { name: "lookup", parameters: schema, ...(strict !== undefined ? { strict } : {}) } });

describe("October tool and limit contracts", () => {
  it("honors positive explicit caps with tools and retains the default floor", () => {
    const request = (fields) => openaiToClaudeRequest("claude-sonnet-4", { messages: [{ role: "user", content: "hello" }], tools: [chatTool()], ...fields }, false).max_tokens;
    expect(request({ max_tokens: 1 })).toBe(1);
    expect(request({ max_completion_tokens: 4096 })).toBe(4096);
    expect(request({ max_tokens: 10, max_completion_tokens: 1 })).toBe(10);
    expect(request({ max_tokens: 0 })).toBeGreaterThan(4096);
  });
  it("maps strict semantics across Chat, Claude, Responses and native Codex", () => {
    for (const value of [undefined, null, false, true]) {
      const chat = { messages: [], tools: [chatTool(value)] };
      expect(openaiToOpenAIResponsesRequest("model", chat, false).tools[0].strict).toBe(value === true);
      const response = { input: [], tools: [{ type: "function", name: "lookup", parameters: schema, ...(value !== undefined ? { strict: value } : {}) }] };
      const fn = openaiResponsesToOpenAIRequest("model", response, false).tools[0].function;
      if (typeof value === "boolean") expect(fn.strict).toBe(value);
      else expect(fn).not.toHaveProperty("strict");
      const claude = claudeToOpenAIRequest("model", { messages: [], tools: [{ name: "lookup", input_schema: schema, ...(value !== undefined ? { strict: value } : {}) }] }, false);
      if (typeof value === "boolean") expect(claude.tools[0].function.strict).toBe(value);
      else expect(claude.tools[0].function).not.toHaveProperty("strict");
    }
    const executor = new CodexExecutor();
    const native = executor.transformRequest("model", { input: [], tools: [{ type: "function", name: "lookup", parameters: schema, strict: null }] }, false, {});
    expect(native.tools[0].strict).toBeNull();
  });
  it("pairs reused Claude IDs by occurrence", () => {
    const messages = ["first", "second"].flatMap((name) => [
      { role: "assistant", content: [{ type: "tool_use", id: "same", name, input: {}, thoughtSignature: `sig-${name}` }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "same", content: name }] },
    ]);
    const parts = claudeToGeminiRequest("gemini-2.5-pro", { messages }, false).contents.flatMap((c) => c.parts);
    expect(parts.filter((p) => p.functionResponse).map((p) => p.functionResponse.name)).toEqual(["first", "second"]);
    expect(parts.filter((p) => p.functionCall).map((p) => p.thoughtSignature)).toEqual(["sig-first", "sig-second"]);
  });
  it("wraps bare Gemini properties without changing a conventional schema", () => {
    const tools = [chatTool()];
    tools[0].function.parameters = { action: { type: "string" }, args: { type: "object", properties: { x: { type: "string" } } } };
    const convert = (tool) => openaiToGeminiRequest("gemini-2.5-pro", { messages: [{ role: "user", content: "hello" }], tools: [tool] }, false).tools[0].functionDeclarations[0].parameters;
    expect(convert(tools[0]).properties).toHaveProperty("action");
    expect(convert(chatTool()).properties).toHaveProperty("value");
  });
  it("keeps tool responses separate from following user text and preserves model ordering", () => {
    const body = { messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call1", content: "ok" },
      { role: "user", content: "next" },
    ] };
    const contents = openaiToGeminiRequest("gemini-2.5-pro", body, false).contents;
    const index = contents.findIndex((c) => c.parts.some((p) => p.functionResponse));
    expect(contents[index - 1].role).toBe("model");
    expect(contents[index].parts.at(-1)).toHaveProperty("functionResponse");
    expect(contents[index + 1].parts).toContainEqual({ text: "next" });
  });
});
