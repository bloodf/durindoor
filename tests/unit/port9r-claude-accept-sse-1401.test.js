// Upstream 9router #1401: /v1/messages stays JSON when `stream` is omitted,
// but a client that accepts only SSE and omits `stream` gets a stream.
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
const { acceptRequestsStream } = await import("../../open-sse/handlers/chatCore/streamFlag.js");

const message = { id: "msg_1", type: "message", role: "assistant", model: "glm-4.6", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } };
const events = [
  { type: "message_start", message: { ...message, content: [], stop_reason: null } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
];

function answer() {
  mocks.execute.mockImplementation(async ({ body, stream }) => ({
    response: stream
      ? new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
      : new Response(JSON.stringify(message), { headers: { "content-type": "application/json" } }),
    url: "https://upstream.test/v1/messages",
    headers: {},
    transformedBody: body,
  }));
}

function call(body, accept) {
  return handleChatCore({
    body,
    modelInfo: { provider: "glm", model: "glm-4.6" },
    credentials: { apiKey: "key", providerSpecificData: {} },
    connectionId: "glm-connection",
    sourceFormatOverride: "claude",
    clientRawRequest: { endpoint: "/v1/messages", body, headers: accept ? { accept } : {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() },
  });
}

const base = () => ({ model: "glm-4.6", max_tokens: 50, messages: [{ role: "user", content: "say hi" }] });

describe("upstream 9router #1401 - /v1/messages stream mode", () => {
  beforeEach(() => { vi.clearAllMocks(); answer(); });

  it("acceptRequestsStream only opts in for omitted stream with SSE-only Accept", () => {
    expect(acceptRequestsStream(undefined, true, false)).toBe(true);
    expect(acceptRequestsStream(false, true, false)).toBe(false);
    expect(acceptRequestsStream(undefined, true, true)).toBe(false);
    expect(acceptRequestsStream(undefined, false, false)).toBe(false);
  });

  it("returns JSON when stream is omitted", async () => {
    const result = await call(base());
    expect(mocks.execute.mock.calls[0][0].stream).toBe(false);
    expect(await result.response.json()).toMatchObject({ type: "message", content: [{ type: "text", text: "hi" }] });
  });

  it("streams when stream is omitted and the client accepts only SSE", async () => {
    const result = await call(base(), "text/event-stream");
    expect(mocks.execute.mock.calls[0][0].stream).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    expect(await result.response.text()).toContain("message_stop");
  });

  it("keeps JSON when the body sets stream:false despite an SSE Accept", async () => {
    const result = await call({ ...base(), stream: false }, "text/event-stream");
    expect(mocks.execute.mock.calls[0][0].stream).toBe(false);
    expect(await result.response.json()).toMatchObject({ type: "message" });
  });
});
