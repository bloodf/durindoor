// #1406: when a provider forces streaming for a non-stream Chat client, the
// request-side tool-name aliases must be restored before the JSON reaches the
// client, as the streaming passthrough already does.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const ALIAS = "mcp_files_read_a1b2c3";
const ORIGINAL = "mcp.files/read";
const toolCall = (name) => ({ index: 0, id: "call_1", type: "function", function: { name, arguments: "{\"path\":\"a\"}" } });

function chatSse() {
  return [
    `data: ${JSON.stringify({ id: "chat-upstream", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [toolCall(ALIAS)] }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: "chat-upstream", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function responsesSse() {
  const frames = [
    ["response.created", { response: { id: "resp-upstream", created_at: 1 } }],
    ["response.output_item.done", { output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: ALIAS, arguments: "{\"path\":\"a\"}", status: "completed" } }],
    ["response.completed", { response: { usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }],
  ];
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function context({ raw, provider = "openai", targetFormat = FORMATS.OPENAI, toolNameMap = new Map([[ALIAS, ORIGINAL]]) }) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat: FORMATS.OPENAI,
    targetFormat,
    provider,
    model: "m",
    body: { model: "m", stream: false },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "event-test",
    toolNameMap,
    terminalProvenance: "upstream",
  };
}

const names = (body) => body.choices[0].message.tool_calls.map((call) => call.function.name);

describe("#1406 forced-SSE JSON restores Chat tool-name aliases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restores aliases on the Chat Completions SSE path", async () => {
    const result = await handleForcedSSEToJson(context({ raw: chatSse() }));
    const body = await result.response.json();
    expect(names(body)).toEqual([ORIGINAL]);
    expect(JSON.stringify(body)).not.toContain(ALIAS);
  });

  it("restores aliases on the Responses-provider SSE path", async () => {
    const result = await handleForcedSSEToJson(context({ raw: responsesSse(), provider: "codex", targetFormat: FORMATS.OPENAI_RESPONSES }));
    const body = await result.response.json();
    expect(names(body)).toEqual([ORIGINAL]);
  });

  it("leaves names alone without an alias map", async () => {
    const result = await handleForcedSSEToJson(context({ raw: chatSse(), toolNameMap: null }));
    expect(names(await result.response.json())).toEqual([ALIAS]);
  });
});
