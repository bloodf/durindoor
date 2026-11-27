import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

describe("9router #5899 Claude upstream Responses failure surfacing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("Unexpected live fetch in Responses failure test");
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps forced-SSE Responses context_length_exceeded to HTTP 400 invalid_request_error before success accounting", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    const raw = `data: ${JSON.stringify({
      type: "response.failed",
      response: {
        id: "resp_fail_1",
        status: "failed",
        error: { code: "context_length_exceeded", message: "Prompt exceeds context window" },
      },
    })}\n\n`;

    const result = await handleForcedSSEToJson({
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
      connectionId: "conn-5899",
      apiKey: null,
      clientRawRequest: { endpoint: "/v1/messages" },
      onRequestSuccess,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      log: { line: vi.fn(), debug: vi.fn() },
      usageEventId: "evt-5899",
      terminalProvenance: "upstream",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    const body = await result.response.json();
    expect(body).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: "Prompt exceeds context window" },
    });
  });

  it("emits a single Claude error event for bare Responses error followed by response.failed", async () => {
    const encoder = new TextEncoder();
    const frames = [
      `event: error\ndata: ${JSON.stringify({ code: "server_overloaded", message: "Backend at capacity" })}\n\n`,
      `event: response.failed\ndata: ${JSON.stringify({
        type: "response.failed",
        response: { id: "resp_dup", status: "failed", error: { code: "server_overloaded", message: "Backend at capacity" } },
      })}\n\n`,
    ];
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
      credentials: { accessToken: "tok-5899" },
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      requestStartTime: Date.now(),
      streamController,
      onStreamComplete: vi.fn(),
      onCoherentTerminal: vi.fn(),
    });

    const output = await res.response.text();
    const errorEvents = [...output.matchAll(/^event: error\ndata: (.+)$/gm)].map((m) => JSON.parse(m[1]));
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toEqual({
      type: "error",
      error: { type: "overloaded_error", message: "Backend at capacity" },
    });
    expect(output).not.toContain("event: message_stop");
  });
});
