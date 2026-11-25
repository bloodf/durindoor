import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const start = {
  type: "message_start",
  message: { id: "msg_01", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, usage: { input_tokens: 12, cache_read_input_tokens: 100 } },
};
const turn = sse([
  start,
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig123" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "OK" } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_01", name: "get_weather", input: {} } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":' } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"Rome"}' } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } },
  { type: "message_stop" },
]);
const failed = sse([start, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);

const tools = [{ name: "get_weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }];

async function run(endpoint, request) {
  const body = { model: "claude-sonnet-4-6", ...request };
  const result = await handleChatCore({
    body,
    modelInfo: { provider: "claude", model: "claude-sonnet-4-6" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    sourceFormatOverride: endpoint === "/v1/messages" ? "claude" : "openai",
    clientRawRequest: { endpoint, body: structuredClone(body), headers: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return result.response;
}

const answer = (payload) => mocks.execute.mockImplementation(async ({ body }) => ({
  response: new Response(payload, { headers: { "content-type": "text/event-stream" } }),
  transformedBody: body, url: "https://upstream.invalid/v1/messages", headers: {},
}));

describe("upstream PR #4695: Anthropic SSE on a non-streaming request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds a chat completion with the text, tool call and usage", async () => {
    answer(turn);
    const response = await run("/v1/chat/completions", {
      messages: [{ role: "user", content: "hi" }],
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, parameters: t.input_schema } })),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("OK");
    expect(json.choices[0].message.tool_calls[0].function).toEqual({ name: "get_weather", arguments: '{"city":"Rome"}' });
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.usage.prompt_tokens).toBe(112);
    expect(json.usage.completion_tokens).toBe(4);
  });

  it("keeps the Anthropic message shape for a Messages client", async () => {
    answer(turn);
    const response = await run("/v1/messages", { max_tokens: 100, messages: [{ role: "user", content: "hi" }], tools });

    expect(response.status, await response.clone().text()).toBe(200);
    const json = await response.json();
    expect(json.type).toBe("message");
    expect(json.content).toEqual([
      { type: "thinking", thinking: "hmm", signature: "sig123" },
      { type: "text", text: "OK" },
      { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "Rome" } },
    ]);
    expect(json.stop_reason).toBe("tool_use");
  });

  it("returns an error, not an empty 200, when the stream fails", async () => {
    answer(failed);
    const response = await run("/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] });

    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain("Overloaded");
  });
});
