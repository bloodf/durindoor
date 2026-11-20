import "./registerAll.js";
import { describe, it, expect } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { validateSearchRoute } from "../../open-sse/translator/concerns/searchRouting.js";
import { responsesSearchToClaudeMessage } from "../../open-sse/translator/response/responses-to-claude.js";
import { openAIResponsesBodyToClaude } from "../../open-sse/translator/response/openai-responses-nonstream.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
const search = { type: "web_search_20250305", name: "web_search" };
const request = () => ({ model: "requested", max_tokens: 100, messages: [{ role: "user", content: "Find it" }], tools: [{ name: "before", input_schema: { type: "object" } }, search, { name: "after", input_schema: { type: "object" } }] });
const item = { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "find it", sources: [{ url: "https://example.test", title: "Example" }] } };
const message = { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "Found", annotations: [{ type: "url_citation", url: "https://example.test", title: "Example" }] }] };
const events = [{ type: "response.created", response: { id: "resp_1" } }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.output_text.delta", delta: "Found" }, { type: "response.output_item.done", output_index: 1, item: message }, { type: "response.completed", response: { status: "completed", output: [item, message], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }];
describe("Claude native search over Codex", () => {
  it("translates only declared search, preserving tool order and source inclusion", () => {
    const body = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "upstream", request(), true, null, "codex");
    expect(body.tools.map(tool => tool.type)).toEqual(["function", "web_search", "function"]);
    expect(body.model).toBe("upstream");
    expect(body.include).toEqual(["web_search_call.action.sources"]);
    const wire = new CodexExecutor().transformRequest("upstream", { ...body, include: [...body.include, "arbitrary"] }, true, {});
    expect(wire.include).toEqual(["reasoning.encrypted_content", "web_search_call.action.sources"]);
    const ordinary = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "upstream", { ...request(), tools: [] }, true, null, "codex");
    expect(ordinary.tools?.some(tool => tool.type === "web_search")).toBeFalsy();
    const chat = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "upstream", { messages: [{ role: "user", content: "hi" }], tools: [{ type: "web_search" }], include: ["arbitrary"] }, true, null, "codex");
    expect(chat.include).toBeUndefined();
  });
  it("preserves a forced Claude search without widening Chat tool choices", () => {
    const body = { ...request(), tool_choice: { type: "tool", name: "web_search" } };
    const converted = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "upstream", body, true, null, "codex");
    expect(converted.tool_choice).toEqual({ type: "web_search" });
    const chat = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "upstream", { messages: [{ role: "user", content: "hi" }], tools: [{ type: "web_search" }], tool_choice: { type: "web_search" } }, true, null, "codex");
    expect(chat.tool_choice).toBeUndefined();
  });
  it("keeps ordinary response translation", () => {
    const state = initState(FORMATS.CLAUDE);
    const output = [{ type: "response.output_text.delta", delta: "ordinary" }, { type: "response.completed", response: { status: "completed", usage: { input_tokens: 2, output_tokens: 1 } } }].flatMap(event => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, event, state));
    expect(output.some(event => event.delta?.text === "ordinary")).toBe(true);
    expect(output.some(event => event.type === "message_stop")).toBe(true);
  });
  it("frames streaming search blocks and usage", () => {
    const state = { ...initState(FORMATS.CLAUDE), model: "requested", searchEnabled: true };
    const output = events.flatMap(event => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, event, state));
    expect(output.find(event => event.type === "message_start").message.model).toBe("requested");
    const starts = output.filter(event => event.type === "content_block_start");
    expect(starts.map(event => event.content_block.type)).toEqual(["server_tool_use", "web_search_tool_result", "text"]);
    expect(starts[1].content_block.content[0].url).toBe("https://example.test");
    expect(output.find(event => event.delta?.type === "input_json_delta").delta.partial_json).toContain("find it");
    expect(output.find(event => event.type === "message_delta").usage.server_tool_use.web_search_requests).toBe(1);
    expect(output.at(-1).type).toBe("message_stop");
  });
  it("streams through the gateway with Claude event framing", async () => {
    const payload = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const input = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } });
    const stream = input.pipeThrough(createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, "codex", null, null, "requested", null, request()));
    const text = await new Response(stream).text();
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("web_search_tool_result");
    expect(text).toContain("web_search_requests");
    expect(text).toContain("event: message_stop");
  });
  it("does not finish a truncated or failed search as a success", () => {
    const state = { ...initState(FORMATS.CLAUDE), model: "requested", searchEnabled: true };
    translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, events[0], state);
    const output = translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, null, state);
    expect(output.some(event => event.type === "error")).toBe(true);
    expect(output.some(event => event.type === "message_stop")).toBe(false);
  });
  it("preserves accumulated search evidence", async () => {
    const payload = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } });
    const response = await convertResponsesStreamToJson(stream);
    const result = responsesSearchToClaudeMessage(response, openAIResponsesBodyToClaude(response), true);
    expect(result.content.map(block => block.type)).toEqual(["server_tool_use", "web_search_tool_result", "text"]);
    expect(result.usage.server_tool_use.web_search_requests).toBe(1);
  });
  it("retains reasoning and client tools in accumulated search responses", () => {
    const response = { output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "think" }] }, item, message,
      { type: "function_call", call_id: "call_1", name: "before", arguments: "{\"x\":1}" }
    ], usage: { input_tokens: 10, output_tokens: 3 } };
    const result = responsesSearchToClaudeMessage(response, openAIResponsesBodyToClaude(response), true);
    expect(result.content.map(block => block.type)).toEqual(["thinking", "server_tool_use", "web_search_tool_result", "text", "tool_use"]);
    expect(result.content.at(-1).input).toEqual({ x: 1 });
    expect(result.stop_reason).toBe("tool_use");
  });
  it("rejects unsupported routes and controls while preserving native routes", () => {
    expect(validateSearchRoute(request(), FORMATS.CLAUDE, FORMATS.OPENAI, "openai")).toMatch(/not supported/);
    expect(validateSearchRoute({ ...request(), tools: [{ ...search, allowed_domains: ["example.test"] }] }, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "codex")).toMatch(/cannot enforce/);
    expect(validateSearchRoute(request(), FORMATS.CLAUDE, FORMATS.CLAUDE, "claude")).toBeNull();
    expect(validateSearchRoute(request(), FORMATS.CLAUDE, FORMATS.CLAUDE, "deepseek")).toBeNull();
  });
});
