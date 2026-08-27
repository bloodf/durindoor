import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: mocks.appendRequestLog,
}));

import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const context = {
  provider: "test-provider",
  model: "test-model",
  connectionId: "connection-12345678",
  apiKey: "client-key",
  requestStartTime: Date.now() - 1000,
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: true,
  finalBody: null,
  translatedBody: null,
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  pxpipe: undefined,
  reqTag: "T1",
  log: null,
};

const encoder = new TextEncoder();

function openPartialResponse({ includeUsage = true } = {}) {
  let controller;
  const body = new ReadableStream({
    start(streamController) {
      controller = streamController;
      const frames = [
        'data: {"id":"partial","choices":[{"index":0,"delta":{"content":"partial answer","reasoning_content":"partial thought"}}]}',
      ];
      if (includeUsage) {
        frames.push('data: {"id":"partial","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}');
      }
      streamController.enqueue(encoder.encode(`${frames.join("\n\n")}\n\n`));
    },
  });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    fail: (error) => controller.error(error),
  };
}

async function startPartialStream({ fail = false } = {}) {
  const ctx = { ...context, usageEventId: "usage-partial" };
  const callbacks = buildOnStreamComplete(ctx);
  const upstream = openPartialResponse({ includeUsage: !fail });
  const streamController = createStreamController({
    provider: ctx.provider,
    model: ctx.model,
    onDisconnect: () => callbacks.onStreamAbandoned("client_disconnected"),
    onError: () => callbacks.onStreamAbandoned("stream_error"),
  });
  const result = await handleStreamingResponse({
    ...ctx,
    providerResponse: upstream.response,
    sourceFormat: "openai",
    targetFormat: "openai",
    streamController,
    onStreamComplete: callbacks.onStreamComplete,
    onStreamAbandoned: callbacks.onStreamAbandoned,
    streamDetailId: callbacks.streamDetailId,
  });
  const reader = result.response.body.getReader();
  await reader.read();
  if (fail) {
    upstream.fail(new Error("upstream interrupted before flush"));
    let streamError;
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (error) {
      streamError = error;
    }
    expect(streamError?.message).toBe("upstream interrupted before flush");
  } else {
    await reader.cancel("client hangup");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  return callbacks;
}

describe("interrupted streaming request detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestDetail.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it("replaces an abandoned stream placeholder with one cancelled detail", () => {
    const { onStreamAbandoned, streamDetailId } = buildOnStreamComplete({ ...context });

    onStreamAbandoned("client_disconnected");
    onStreamAbandoned("stream_error");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    const detail = mocks.saveRequestDetail.mock.calls[0][0];
    expect(detail).toMatchObject({
      id: streamDetailId,
      status: "cancelled",
      response: { type: "streaming" },
    });
    expect(detail.response.content).toContain("client_disconnected");
    expect(detail.response.content).not.toContain("Streaming in progress");
  });

  it("persists partial content and reported usage once when the client hangs up", async () => {
    const callbacks = await startPartialStream();

    const interrupted = mocks.saveRequestDetail.mock.calls
      .map(([detail]) => detail)
      .filter((detail) => detail.status === "cancelled");
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({
      response: { content: "partial answer", thinking: "partial thought", type: "streaming" },
      tokens: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    });
    expect(interrupted[0].latency.ttft).toBeGreaterThan(0);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toMatchObject({
      usageEventId: "usage-partial",
      tokens: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    });
    expect(mocks.saveRequestUsage.mock.calls[0][0].status).toBe("cancelled");
    expect(new Set(mocks.saveRequestDetail.mock.calls.map(([detail]) => detail.id))).toEqual(new Set([callbacks.streamDetailId]));
  });

  it("finalizes a pre-flush stream error once despite callback races", async () => {
    const callbacks = await startPartialStream({ fail: true });

    const interrupted = mocks.saveRequestDetail.mock.calls
      .map(([detail]) => detail)
      .filter((detail) => detail.status === "cancelled");
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].response).toMatchObject({ content: "partial answer", thinking: "partial thought" });
    expect(interrupted[0].tokens).toMatchObject({ estimated: true });
    expect(interrupted[0].tokens.prompt_tokens).toBeGreaterThan(0);
    expect(interrupted[0].tokens.completion_tokens).toBeGreaterThan(0);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.saveRequestDetail.mock.calls.map(([detail]) => detail.id))).toEqual(new Set([callbacks.streamDetailId]));
  });

  it("keeps one successful detail when completion precedes abandonment", () => {
    const { onStreamComplete, onStreamAbandoned, streamDetailId } = buildOnStreamComplete({ ...context });

    onStreamComplete({ content: "done" }, { prompt_tokens: 5, completion_tokens: 7 }, Date.now());
    onStreamAbandoned("client_disconnected");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestDetail.mock.calls[0][0]).toMatchObject({
      id: streamDetailId,
      status: "success",
      response: { content: "done" },
    });
  });
});
