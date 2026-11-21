import { describe, expect, it, vi } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { MAX_RESPONSES_OUTPUT_ITEMS } from "../../open-sse/config/runtimeConfig.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

const output = [
  { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "find it", sources: [{ url: "https://example.test", title: "Example" }] } },
  { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "Found it", annotations: [{ type: "url_citation", url: "https://example.test", title: "Example", start_index: 0, end_index: 5 }] }] },
  { id: "fc_1", type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"id":1}', status: "completed" },
];
const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const completed = (items = output) => frame("response.completed", { response: { status: "completed", output: items, usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } });
const convert = (raw) => convertResponsesStreamToJson(new Response(raw).body);

describe("completed Responses terminal output", () => {
  it("preserves terminal-only items and usage", async () => {
    expect(await convert(completed())).toMatchObject({ status: "completed", output, usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } });
  });

  it("combines missing terminal items in index order while retaining observed items", async () => {
    const observed = { ...output[1], content: [{ type: "output_text", text: "streamed", annotations: [] }] };
    const raw = frame("response.output_item.done", { output_index: 1, item: observed }) + completed();
    expect(await convert(raw)).toMatchObject({ status: "completed", output: [output[0], observed, output[2]] });
  });

  it("projects terminal-only search, text and tool metadata to Claude", async () => {
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(completed(), { headers: { "content-type": "text/event-stream" } }),
      provider: "codex", model: "requested", sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI_RESPONSES,
      body: { model: "requested", messages: [{ role: "user", content: "find it" }], tools: [{ type: "web_search_20250305", name: "web_search" }], stream: false },
      stream: false, requestStartTime: Date.now(), clientRawRequest: { endpoint: "/v1/messages" }, trackDone: vi.fn(), appendLog: vi.fn(), claudeClassifierCompat: "off",
    });
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.content.map((item) => item.type)).toEqual(["server_tool_use", "web_search_tool_result", "text", "tool_use"]);
    expect(body.content[1].content[0].url).toBe("https://example.test");
    expect(body.content[2]).toMatchObject({ text: "Found it" });
    expect(body.content[3]).toMatchObject({ id: "call_1", name: "lookup", input: { id: 1 } });
    expect(body.usage).toMatchObject({ input_tokens: 10, output_tokens: 3 });
  });

  it("preserves incomplete output and rejects malformed terminal output", async () => {
    expect(await convert(frame("response.incomplete", { response: { status: "incomplete", output } }))).toMatchObject({ status: "incomplete", output });
    expect(await convert(frame("response.incomplete", { response: { status: "incomplete" } }))).toMatchObject({ status: "incomplete", output: [] });
    for (const items of [{}, [null], Array(MAX_RESPONSES_OUTPUT_ITEMS + 1).fill(output[0])]) {
      expect((await convert(completed(items))).status).toBe("failed");
    }
  });

  it("keeps duplicate and sparse streamed indexes invalid", async () => {
    const item = (index) => frame("response.output_item.done", { output_index: index, item: output[0] });
    expect((await convert(item(0) + item(0) + completed())).status).toBe("failed");
    expect((await convert(item(2) + completed([]))).status).toBe("failed");
  });
});
