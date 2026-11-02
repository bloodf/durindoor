// handleChatCore routes a non-streaming request on a forced-SSE Claude transport
// through the SSE→JSON handler, and hands it the request-side tool aliases.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute, refreshCredentials: vi.fn().mockResolvedValue(null) })),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  maskSensitiveUrl: vi.fn((url) => url),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const events = (toolName) => [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "k3", content: [], usage: { input_tokens: 3, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: toolName, input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"path\":\"/a\"}" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
  { type: "message_stop" },
];

function upstream(raw, body) {
  return {
    response: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    url: "https://upstream.test/v1",
    headers: {},
    transformedBody: body,
  };
}

function answerWithClaudeSse() {
  mocks.execute.mockImplementation(async ({ body }) => upstream(
    events(body.tools[0].name).map((event) => `event:${event.type}\ndata:${JSON.stringify(event)}\n\n`).join(""),
    body,
  ));
}

function request(body, endpoint, overrides = {}) {
  return {
    body,
    modelInfo: { provider: "kimi-coding-apikey", model: "kimi-for-coding" },
    credentials: { apiKey: "key", providerSpecificData: {} },
    connectionId: "kimi-connection",
    clientRawRequest: { endpoint, body, headers: { accept: "application/json" } },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() },
    ...overrides,
  };
}

const chatTool = (name) => ({ type: "function", function: { name, parameters: { type: "object", properties: {} } } });

describe("chatCore with a forced-SSE upstream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a chat.completion to a Chat client on a Claude transport", async () => {
    answerWithClaudeSse();
    const result = await handleChatCore(request({
      model: "kimi-for-coding",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      tools: [chatTool("Read")],
    }, "/v1/chat/completions"));

    expect(mocks.execute.mock.calls[0][0].body.stream).toBe(true);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls[0].function).toEqual({ name: "Read", arguments: "{\"path\":\"/a\"}" });
  });

  it("returns a Claude message to a Claude client on a Claude transport", async () => {
    answerWithClaudeSse();
    const result = await handleChatCore(request({
      model: "kimi-for-coding",
      stream: false,
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }],
    }, "/v1/messages", { sourceFormatOverride: "claude" }));

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body).toMatchObject({ type: "message", stop_reason: "tool_use" });
    expect(body.content).toEqual([{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } }]);
  });

  it("keeps streaming clients on the SSE path", async () => {
    answerWithClaudeSse();
    const result = await handleChatCore(request({
      model: "kimi-for-coding",
      stream: true,
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }],
    }, "/v1/messages", { sourceFormatOverride: "claude" }));

    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    const text = await result.response.text();
    expect(text).toMatch(/event: ?message_stop/);
    expect(text).toContain("input_json_delta");
  });

  it("hands the request-side tool aliases to the forced SSE handler", async () => {
    const original = "mcp.server/read";
    mocks.execute.mockImplementation(async ({ body }) => upstream([
      { id: "c1", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: body.tools[0].function.name, arguments: "{}" } }] }, finish_reason: null }] },
      { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", body));

    const result = await handleChatCore(request({
      model: "x-preview-f-free",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      tools: [chatTool(original)],
    }, "/v1/chat/completions", { modelInfo: { provider: "opencode", model: "x-preview-f-free" } }));

    expect(mocks.execute.mock.calls[0][0].body.tools[0].function.name).not.toBe(original);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.tool_calls[0].function.name).toBe(original);
  });
});
