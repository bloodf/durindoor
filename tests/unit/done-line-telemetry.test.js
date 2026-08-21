import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

afterEach(() => vi.restoreAllMocks());

function forcedSseOptions({ raw, provider, targetFormat, finalBody }) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat: FORMATS.OPENAI,
    targetFormat,
    provider,
    model: "gpt-test",
    body: { model: "gpt-test", stream: false },
    stream: true,
    translatedBody: { conversationState: { conversationId: "translated-session" } },
    finalBody,
    requestStartTime: 3000,
    connectionId: "connection",
    apiKey: null,
    clientRawRequest: null,
    onRequestSuccess: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    toolNameMap: null,
    reqTag: "forced-tag",
    log: { line: vi.fn() },
    usageEventId: "usage-event",
    claudeClassifierCompat: "off",
  };
}

describe("DONE telemetry", () => {
  const usage = { prompt_tokens: 100, completion_tokens: 42 };
  const latency = { total: 2537, ttft: 2530 };

  it("keeps the legacy line byte-identical without optional telemetry", () => {
    expect(formatDoneLine({ usage, latency })).toBe(
      "DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42",
    );
  });

  it("appends route, finite Kiro credits, and session identity in stable order", () => {
    expect(formatDoneLine({
      usage: { ...usage, kiro_credits: 0.21239843011608625 },
      latency,
      provider: "kiro",
      model: "claude-opus-4.8",
      sessionId: "session-abc",
    })).toBe(
      "DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · kiro/claude-opus-4.8 · 0.2124cr · sid:session-",
    );
  });

  it.each([
    ["absent", {}],
    ["null", { kiro_credits: null }],
    ["NaN", { kiro_credits: Number.NaN }],
    ["string numeric", { kiro_credits: "0.5" }],
    ["positive infinity", { kiro_credits: Number.POSITIVE_INFINITY }],
    ["negative infinity", { kiro_credits: Number.NEGATIVE_INFINITY }],
    ["negative finite", { kiro_credits: -0.5 }],
  ])("omits %s Kiro credits", (_label, creditUsage) => {
    expect(formatDoneLine({
      usage: { ...usage, ...creditUsage },
      latency,
      provider: "kiro",
      model: "claude-opus-4.8",
    })).toBe(
      "DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · kiro/claude-opus-4.8",
    );
  });

  it.each([
    ["claude", "claude:0f8e1c2a-3b4d-5678-9abc-def012345678", "0f8e1c2a"],
    ["antigravity", "antigravity:12345678-3b4d-5678-9abc-def012345678", "12345678"],
  ])("strips the known %s session scope before bounding identity", (_scope, sessionId, expected) => {
    expect(formatDoneLine({ usage, latency, sessionId })).toBe(
      `DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · sid:${expected}`,
    );
  });

  it("strips controls before removing a known session scope", () => {
    const line = formatDoneLine({ usage, latency, sessionId: "claude:\n\0\x1b0f8e1c2a-3b4d" });
    expect(line).toBe("DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · sid:0f8e1c2a");
    expect(line).not.toMatch(/[\n\0\x1b]/);
  });

  it.each([
    ["unprefixed", "123456789abcdef", "12345678"],
    ["unknown colon prefix", "custom:abcdef", "custom:a"],
  ])("bounds %s session identity without stripping it", (_label, sessionId, expected) => {
    expect(formatDoneLine({ usage, latency, sessionId })).toBe(
      `DONE 2537ms · TTFT 2530ms · IN 100 · OUT 42 · sid:${expected}`,
    );
  });

  it("threads streaming route and final provider-body session identity to DONE", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1010);
    const log = { line: vi.fn() };
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "kiro",
      model: "claude-opus-4.8",
      connectionId: "connection",
      requestStartTime: 1000,
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      translatedBody: { conversationState: { conversationId: "translated-session" } },
      finalBody: { conversationState: { conversationId: "stream-session" } },
      reqTag: "stream-tag",
      log,
    });

    onStreamComplete(
      { content: "done" },
      { prompt_tokens: 7, completion_tokens: 3, kiro_credits: 0.5 },
      1005,
    );

    expect(log.line).toHaveBeenCalledWith(
      "stream-tag",
      "📊",
      "DONE 10ms · TTFT 5ms · IN 7 · OUT 3 · kiro/claude-opus-4.8 · 0.5cr · sid:stream-s",
    );
    now.mockRestore();
  });

  it("threads non-streaming route and final provider-body session identity to DONE", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(2010);
    const log = { line: vi.fn() };
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }), { headers: { "content-type": "application/json" } }),
      provider: "kiro",
      model: "claude-opus-4.8",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: false,
      streamToClient: false,
      translatedBody: { conversationState: { conversationId: "translated-session" } },
      finalBody: { conversationState: { conversationId: "nonstream-session" } },
      requestStartTime: 2000,
      connectionId: "connection",
      apiKey: null,
      clientRawRequest: null,
      onRequestSuccess: null,
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      pxpipe: null,
      reqTag: "nonstream-tag",
      log,
      usageEventId: "usage-event",
      claudeClassifierCompat: "off",
    });

    expect(result.success).toBe(true);
    expect(log.line).toHaveBeenCalledWith(
      "nonstream-tag",
      "📊",
      "DONE 10ms · IN 7 · OUT 3 · kiro/claude-opus-4.8 · sid:nonstrea",
    );
    now.mockRestore();
  });

  it("threads route identity through forced Responses SSE completion", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3010);
    const raw = [
      'event: response.created\ndata: {"response":{"id":"resp-test","created_at":123}}',
      'event: response.output_item.done\ndata: {"output_index":0,"item":{"type":"message","id":"msg-test","role":"assistant","content":[{"type":"output_text","text":"done"}]}}',
      'event: response.completed\ndata: {"response":{"usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}}}',
    ].join("\n\n");
    const options = forcedSseOptions({
      raw,
      provider: "codex",
      targetFormat: FORMATS.OPENAI_RESPONSES,
      finalBody: { conversationState: { conversationId: "responses-session" } },
    });

    const result = await handleForcedSSEToJson(options);

    expect(result.success).toBe(true);
    expect(options.log.line).toHaveBeenCalledWith(
      "forced-tag",
      "📊",
      "DONE 10ms · IN 7 · OUT 3 · codex/gpt-test · sid:response",
    );
  });

  it("threads route identity through forced Chat Completions SSE completion", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3010);
    const raw = [
      'data: {"id":"chat-test","created":123,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant","content":"done"},"finish_reason":null}]}',
      'data: {"id":"chat-test","created":123,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const options = forcedSseOptions({
      raw,
      provider: "openai",
      targetFormat: FORMATS.OPENAI,
      finalBody: { conversationState: { conversationId: "chat-session" } },
    });

    const result = await handleForcedSSEToJson(options);

    expect(result.success).toBe(true);
    expect(options.log.line).toHaveBeenCalledWith(
      "forced-tag",
      "📊",
      "DONE 10ms · IN 7 · OUT 3 · openai/gpt-test · sid:chat-ses",
    );
  });
});
