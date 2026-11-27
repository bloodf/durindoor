import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createSseFrameReader } from "../../open-sse/utils/sseFrames.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

function parseSseFrames(text) {
  const reader = createSseFrameReader();
  return [...reader.push(text), ...reader.flush()].map((frame) => ({
    event: frame.eventName,
    data: frame.data.trim() === "[DONE]" ? "[DONE]" : JSON.parse(frame.data),
  }));
}

function runForcedSse(raw, { credentials = null, onRequestSuccess = vi.fn(async () => {}) } = {}) {
  return handleForcedSSEToJson({
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "codex",
    model: "gpt-5.4",
    body: { model: "gpt-5.4", stream: false },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "conn-5899-fix",
    apiKey: null,
    credentials,
    clientRawRequest: { endpoint: "/v1/messages" },
    onRequestSuccess,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "evt-5899-fix",
    terminalProvenance: "upstream",
  });
}

async function runStreamingFrames(frames, { credentials = null } = {}) {
  const encoder = new TextEncoder();
  const upstream = new ReadableStream({
    start(controller) {
      for (const chunk of frames) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const streamController = createStreamController({ onComplete: vi.fn(), onError: vi.fn() });
  const res = await handleStreamingResponse({
    providerResponse: new Response(upstream, { headers: { "content-type": "text/event-stream" } }),
    provider: "codex",
    model: "gpt-5.4",
    targetFormat: FORMATS.OPENAI_RESPONSES,
    sourceFormat: FORMATS.CLAUDE,
    credentials,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    requestStartTime: Date.now(),
    streamController,
    onStreamComplete: vi.fn(),
    onCoherentTerminal: vi.fn(),
  });
  return res.response.text();
}

describe("Claude Responses failure redaction and error mapping (9router #5899 follow-up)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("Unexpected live fetch in Responses failure test");
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: "server_overloaded to 503 overloaded_error",
      error: { code: "server_overloaded", message: "at capacity opaque-tok-999" },
      expectedStatus: 503,
      expectedType: "overloaded_error",
      expectedMessage: "at capacity [redacted]",
    },
    {
      name: "type-only invalid_request_error to 400 invalid_request_error",
      error: { type: "invalid_request_error", message: "Invalid input opaque-tok-999" },
      expectedStatus: 400,
      expectedType: "invalid_request_error",
      expectedMessage: "Invalid input [redacted]",
    },
  ])("redacts credential tokens and maps $name on forced-SSE JSON path", async ({
    error,
    expectedStatus,
    expectedType,
    expectedMessage,
  }) => {
    const onRequestSuccess = vi.fn(async () => {});
    const secret = "opaque-tok-999";
    const raw = `data: ${JSON.stringify({
      type: "response.failed",
      response: { id: "resp_fail", status: "failed", error },
    })}\n\n`;

    const result = await runForcedSse(raw, { credentials: { accessToken: secret }, onRequestSuccess });

    expect(result.success).toBe(false);
    expect(result.status).toBe(expectedStatus);
    expect(result.response.status).toBe(expectedStatus);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    const rawBody = await result.response.text();
    expect(rawBody).not.toContain(secret);
    expect(result.error).not.toContain(secret);
    expect(JSON.stringify(result.errorBody)).not.toContain(secret);
    expect(JSON.parse(rawBody)).toEqual({
      type: "error",
      error: { type: expectedType, message: expectedMessage },
    });
  });

  it.each([
    {
      name: "server_overloaded to overloaded_error",
      eventName: "response.failed",
      payload: {
        type: "response.failed",
        response: {
          id: "resp_stream_overload",
          status: "failed",
          error: { code: "server_overloaded", message: "at capacity opaque-tok-999" },
        },
      },
      expectedType: "overloaded_error",
      expectedMessage: "at capacity [redacted]",
    },
    {
      name: "type-only invalid_request_error without stream_error shadow",
      eventName: "response.failed",
      payload: {
        type: "response.failed",
        response: {
          id: "resp_stream_invalid",
          status: "failed",
          error: { type: "invalid_request_error", message: "Bad request opaque-tok-999" },
        },
      },
      expectedType: "invalid_request_error",
      expectedMessage: "Bad request [redacted]",
    },
    {
      name: "flat error event with type-only invalid_request_error",
      eventName: "error",
      payload: {
        type: "invalid_request_error",
        message: "Flat bad request opaque-tok-999",
      },
      expectedType: "invalid_request_error",
      expectedMessage: "Flat bad request [redacted]",
    },
  ])("redacts credential tokens and preserves $name on streaming path", async ({
    eventName,
    payload,
    expectedType,
    expectedMessage,
  }) => {
    const secret = "opaque-tok-999";
    const output = await runStreamingFrames([
      `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`,
    ], { credentials: { accessToken: secret } });

    expect(output).not.toContain(secret);
    const frames = parseSseFrames(output);
    const errorEvents = frames.filter((frame) => frame.event === "error").map((frame) => frame.data);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toEqual({
      type: "error",
      error: { type: expectedType, message: expectedMessage },
    });
    expect(frames.some((frame) => frame.event === "message_stop")).toBe(false);
  });
});
