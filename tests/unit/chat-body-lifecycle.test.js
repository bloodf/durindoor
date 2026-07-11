import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function deferredResponse(contentType) {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": contentType } }),
    controller,
  };
}

function common(trackDone, onRequestSuccess = vi.fn()) {
  return {
    provider: "openai",
    model: "gpt-test",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    translatedBody: { model: "gpt-test", stream: true, messages: [{ role: "user", content: "hi" }] },
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "conn",
    apiKey: null,
    clientRawRequest: null,
    onRequestSuccess,
    trackDone,
    appendLog: vi.fn(),
    toolNameMap: null,
    reqTag: "",
    log: {},
    usageEventId: "usage-event",
    claudeClassifierCompat: "off",
    terminalProvenance: "upstream",
  };
}

describe("chat upstream body lifecycle", () => {
  it("holds forced-SSE concurrency until the body is consumed", async () => {
    const trackDone = vi.fn();
    const success = vi.fn();
    const deferred = deferredResponse("text/event-stream");
    const pending = handleForcedSSEToJson({
      ...common(trackDone, success),
      providerResponse: deferred.response,
    });
    await Promise.resolve();
    expect(trackDone).not.toHaveBeenCalled();

    const encoder = new TextEncoder();
    deferred.controller.enqueue(encoder.encode(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`,
    ));
    deferred.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    deferred.controller.close();

    const result = await pending;
    expect(result.success).toBe(true);
    expect(success).toHaveBeenCalledOnce();
    expect(trackDone).toHaveBeenCalledOnce();
  });

  it("does not clear success for a parseable but truncated forced stream", async () => {
    const trackDone = vi.fn();
    const success = vi.fn();
    const partial = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\n`;
    const result = await handleForcedSSEToJson({
      ...common(trackDone, success),
      providerResponse: new Response(partial, { headers: { "content-type": "text/event-stream" } }),
    });
    expect(result.success).toBe(false);
    expect(success).not.toHaveBeenCalled();
    expect(trackDone).toHaveBeenCalledOnce();
  });

  it("aborts a hung forced-SSE body and releases concurrency", async () => {
    const trackDone = vi.fn();
    const success = vi.fn();
    const controller = new AbortController();
    const deferred = deferredResponse("text/event-stream");
    const pending = handleForcedSSEToJson({
      ...common(trackDone, success),
      providerResponse: deferred.response,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect(success).not.toHaveBeenCalled();
    expect(trackDone).toHaveBeenCalledOnce();
  });

  it("holds non-streaming concurrency until JSON consumption finishes", async () => {
    const trackDone = vi.fn();
    const deferred = deferredResponse("application/json");
    const pending = handleNonStreamingResponse({
      ...common(trackDone),
      stream: false,
      streamToClient: false,
      providerResponse: deferred.response,
      reqLogger: {
        logProviderResponse: vi.fn(),
        logConvertedResponse: vi.fn(),
      },
    });
    await Promise.resolve();
    expect(trackDone).not.toHaveBeenCalled();
    deferred.controller.enqueue(new TextEncoder().encode(JSON.stringify({
      id: "chatcmpl-test",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    })));
    deferred.controller.close();
    const result = await pending;
    expect(result.success).toBe(true);
    expect(trackDone).toHaveBeenCalledOnce();
  });

  it("aborts a hung non-streaming body and releases concurrency", async () => {
    const trackDone = vi.fn();
    const controller = new AbortController();
    const deferred = deferredResponse("application/json");
    const pending = handleNonStreamingResponse({
      ...common(trackDone),
      stream: false,
      streamToClient: false,
      providerResponse: deferred.response,
      signal: controller.signal,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    await Promise.resolve();
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect(trackDone).toHaveBeenCalledOnce();
  });

  it("bounds oversized non-streaming bodies and releases concurrency", async () => {
    const trackDone = vi.fn();
    const result = await handleNonStreamingResponse({
      ...common(trackDone),
      stream: false,
      streamToClient: false,
      providerResponse: new Response(`{"content":"${"x".repeat(8 * 1024 * 1024 + 1)}"}`, {
        headers: { "content-type": "application/json" },
      }),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(trackDone).toHaveBeenCalledOnce();
  });

  it("never logs provider payload fragments from JSON parse errors", async () => {
    const canary = "PROVIDER_SECRET_CANARY token=do-not-log";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await handleNonStreamingResponse({
      ...common(vi.fn()),
      stream: false,
      streamToClient: false,
      providerResponse: new Response(`{"broken":"${canary}`, {
        headers: { "content-type": "application/json" },
      }),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(false);
    expect(error.mock.calls.flat().join(" ")).not.toContain(canary);
    error.mockRestore();
  });

  it.each([
    ["null", null],
    ["empty", {}],
    ["structured error", { error: { message: "provider failed" } }],
  ])("rejects a parseable 200 %s body without clearing health", async (_label, payload) => {
    const success = vi.fn();
    const result = await handleNonStreamingResponse({
      ...common(vi.fn(), success),
      stream: false,
      streamToClient: false,
      providerResponse: new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      }),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(success).not.toHaveBeenCalled();
  });

  it.each([
    [null, 0],
    ["upstream", 1],
    ["validated", 1],
  ])("gates coherent non-stream cleanup by provenance %s", async (terminalProvenance, expectedCalls) => {
    const success = vi.fn();
    const result = await handleNonStreamingResponse({
      ...common(vi.fn(), success),
      terminalProvenance,
      stream: false,
      streamToClient: false,
      providerResponse: new Response(JSON.stringify({
        id: "chatcmpl-test",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }), { headers: { "content-type": "application/json" } }),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(true);
    expect(success).toHaveBeenCalledTimes(expectedCalls);
  });

  it.each([
    ["Claude content:null", {
      id: "msg-empty",
      type: "message",
      role: "assistant",
      model: "MiniMax-M3",
      content: null,
      stop_reason: "max_tokens",
      usage: { input_tokens: 2, output_tokens: 1 },
    }],
    ["OpenAI-shaped Claude compatibility", {
      id: "chatcmpl-xiaomi",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    }],
  ])("accepts the documented %s non-stream shape", async (_label, payload) => {
    const result = await handleNonStreamingResponse({
      ...common(vi.fn()),
      targetFormat: FORMATS.CLAUDE,
      stream: false,
      streamToClient: false,
      providerResponse: new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      }),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices?.[0]?.finish_reason).toBeTruthy();
  });

  it("rejects an empty streaming body and releases through the stream controller", async () => {
    const handleError = vi.fn();
    const result = await handleStreamingResponse({
      ...common(vi.fn()),
      providerResponse: new Response(null, { headers: { "content-type": "text/event-stream" } }),
      reqLogger: null,
      streamController: { handleError },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(handleError).toHaveBeenCalledOnce();
  });

  it("redacts credentials from short non-SSE provider bodies", async () => {
    const handleError = vi.fn();
    const result = await handleStreamingResponse({
      ...common(vi.fn()),
      providerResponse: new Response("Authorization: Bearer provider-secret-token", {
        headers: { "content-type": "text/plain" },
      }),
      reqLogger: null,
      streamController: { handleError },
    });
    const text = await result.response.text();
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("provider-secret-token");
    expect(handleError).toHaveBeenCalledOnce();
  });
});
