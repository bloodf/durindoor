import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { QwenExecutor } from "../../open-sse/executors/qwen.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const contentSse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n';
const finishSse = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const usageSse = 'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":4,"total_tokens":11}}\n\n';

describe("Qwen executor include_usage propagation", () => {
  it("uses executor-injected framing and completes with trailing real usage", async () => {
    const executor = new QwenExecutor();
    const originalBody = {
      model: "test",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    };
    const finalBody = executor.transformRequest("test", structuredClone(originalBody), true, {});
    let completionCalls = 0;
    let completion;
    const streamController = {
      signal: new AbortController().signal,
      startTime: Date.now(),
      isConnected: () => true,
      handleComplete: () => {},
      handleError: () => {},
      handleDisconnect: () => {},
      abort: () => {},
    };

    expect(originalBody.stream_options).toBeUndefined();
    expect(finalBody.stream_options).toEqual({ include_usage: true });

    let upstreamController;
    const providerResponse = new Response(new ReadableStream({
      start(controller) {
        upstreamController = controller;
      },
    }), {
      headers: { "content-type": "text/event-stream" },
    });

    const result = await handleStreamingResponse({
      providerResponse,
      provider: "qwen",
      model: "test",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      body: originalBody,
      translatedBody: originalBody,
      finalBody,
      stream: true,
      requestStartTime: Date.now(),
      connectionId: null,
      apiKey: null,
      reqLogger: null,
      toolNameMap: null,
      onStreamComplete: (...args) => {
        completionCalls += 1;
        completion = args;
      },
      streamController,
    });
    const drain = result.response.arrayBuffer();

    upstreamController.enqueue(new TextEncoder().encode(contentSse));
    upstreamController.enqueue(new TextEncoder().encode(finishSse));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completionCalls).toBe(0);

    upstreamController.enqueue(new TextEncoder().encode(usageSse));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completionCalls).toBe(1);
    upstreamController.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    upstreamController.close();
    await drain;

    expect(completionCalls).toBe(1);
    expect(completion[1]).toMatchObject({
      prompt_tokens: 7,
      completion_tokens: 4,
      total_tokens: 11,
    });
    expect(completion[1].estimated).not.toBe(true);
  });
});
