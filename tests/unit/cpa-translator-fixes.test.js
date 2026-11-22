import "../translator/registerAll.js";
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";
import { resolveClientSessionId } from "../../open-sse/utils/sessionManager.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

describe("CLIProxyAPI translator fixes", () => {
  it("preserves keyword-named properties and normalizes tuple items", () => {
    const schema = cleanJSONSchemaForAntigravity({ type: "object", properties: {
      const: { type: "string", const: "x" }, enum: { type: "string" },
      additionalProperties: { type: "string" }, tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
      empty: { type: "array", items: false },
    } });
    expect(schema.properties.const.enum).toEqual(["x"]);
    expect(schema.properties.enum.type).toBe("string");
    expect(schema.properties.additionalProperties.type).toBe("string");
    expect(Array.isArray(schema.properties.tuple.items)).toBe(false);
    expect(schema.properties.empty.items).toEqual({ type: "string" });
    expect(schema.properties.empty.description).toContain("No items allowed");
  });

  it("isolates subagents sharing a header session and escapes reserved delimiters", () => {
    const session = (id, agent) => resolveClientSessionId({ headers: { "x-session-id": id, "x-agent-id": agent }, body: {} });
    expect(session("s", "a")).not.toBe(session("s", "b"));
    expect(session("s", "a")).not.toBe(session("s:agent:a", "main"));
    expect(session("s", "main")).toBe("s");
  });

  it("hoists Responses tool output cache control onto the Claude result", () => {
    const body = { input: [
      { type: "function_call", call_id: "call1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call1", output: [{ type: "input_text", text: "ok", cache_control: { type: "ephemeral", ttl: "1h" } }] },
    ] };
    const chat = openaiResponsesToOpenAIRequest("test", body, false);
    const claude = openaiToClaudeRequest("test", chat, false);
    const result = claude.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []).find((block) => block.type === "tool_result");
    expect(result.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("replays adjacent thinking blocks from the same response, replacing duplicates and older responses", () => {
    const reasoning = (id, text) => ({ type: "reasoning", id, encrypted_content: "Eg==", summary: [{ type: "summary_text", text }] });
    const body = { input: [reasoning("rs_old_0", "old"), reasoning("rs_new_0", "first"), reasoning("rs_new_1", "stale"), reasoning("rs_new_1", "second"),
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] }] };
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "test", body, false);
    const blocks = result.messages.flatMap((message) => message.content).filter((block) => block.type === "thinking");
    expect(blocks.map((block) => block.thinking)).toEqual(["first", "second"]);
    expect(blocks.map((block) => block.signature)).toEqual(["Eg==", "Eg=="]);
  });

  it("retains only supported Codex include values for each backend", () => {
    const executor = new CodexExecutor();
    const input = () => ({ input: "hello", include: ["file_search_call.results", "web_search_call.results", "output.encrypted_content", "bogus", "web_search_call.results"] });
    const chatgpt = executor.transformRequest("gpt-5", input(), true, {});
    expect(chatgpt.include).toEqual(["reasoning.encrypted_content", "web_search_call.results", "output.encrypted_content"]);
    const platform = executor.transformRequest("gpt-5", input(), true, {}, null, "https://api.example.test/v1/responses");
    expect(platform.include).toEqual(["reasoning.encrypted_content", "web_search_call.results", "file_search_call.results", "output.encrypted_content"]);
    const compact = executor.transformRequest("gpt-5", input(), true, {}, { compact: true });
    expect(compact.include).toBeUndefined();
  });

  it("preserves an orphan output cache marker on Claude text", () => {
    const body = { input: [{ type: "function_call_output", call_id: "missing", output: "result", cache_control: { type: "ephemeral" } }] };
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "test", body, false);
    expect(result.messages[0].content).toContainEqual({ type: "text", text: "result", cache_control: { type: "ephemeral" } });
  });


  it("preserves the last valid part marker ahead of the output marker on the Claude wire", () => {
    const body = { input: [
      { type: "function_call", call_id: "call1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call1", cache_control: { type: "ephemeral", ttl: "5m" }, output: [
        { type: "input_text", text: "a", cache_control: { type: "ephemeral" } },
        { type: "input_text", text: "b", cache_control: { type: "ephemeral", ttl: "1h" } },
      ] },
    ] };
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "test", body, false);
    const block = result.messages.flatMap((message) => message.content).find((part) => part.type === "tool_result");
    expect(block.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(block.content).toBe("a\nb");
  });

  it("uses output-level cache control when a part marker is invalid", () => {
    const body = { input: [
      { type: "function_call", call_id: "call1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call1", cache_control: { type: "ephemeral" }, output: [{ type: "input_text", text: "ok", cache_control: { type: "invalid" } }] },
    ] };
    const result = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "test", body, false);
    expect(result.messages.flatMap((message) => message.content).find((part) => part.type === "tool_result").cache_control).toEqual({ type: "ephemeral" });
  });


  it("normalizes boolean, nullable, and malformed native array items", () => {
    const clean = (items, options) => cleanJSONSchemaForAntigravity({ type: "array", items }, options);
    expect(clean(true).items).toEqual({ type: "string" });
    expect(clean(42).items).toEqual({ type: "string" });
    expect(clean([{ type: "null" }, { type: "string" }]).items).toMatchObject({ type: "string", description: "(nullable)" });
    expect(clean([{ type: "null" }, { type: "string" }], { preserveNullable: true }).items.nullable).toBe(true);
  });

});
