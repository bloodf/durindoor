import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ANTHROPIC_PING_FRAME } from "../../open-sse/utils/earlyStreamKeepalive.js";
import { createDisconnectAwareStream, createStreamController } from "../../open-sse/utils/streamHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "test-agent",
  updateKimchiUserAgent: vi.fn(async () => "test-agent"),
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();


function hangingBody() {
  let controller;
  return {
    body: new ReadableStream({ start(value) { controller = value; } }),
    enqueue: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

function streamController(format) {
  return createStreamController({ provider: format, model: "test", log: { line: vi.fn() } });
}

async function settledRead(readPromise) {
  let result;
  readPromise.then((value) => { result = value; });
  await Promise.resolve();
  return result;
}

async function streamingResult(sourceFormat, targetFormat) {
  const upstream = hangingBody();
  const result = await handleStreamingResponse({
    providerResponse: new Response(upstream.body, { headers: { "content-type": "text/event-stream" } }),
    provider: "test-provider",
    model: "test-model",
    sourceFormat,
    targetFormat,
    body: { stream: true, messages: [] },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    streamController: streamController(targetFormat),
  });
  return { upstream, reader: result.response.body.getReader() };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("port #3457: Claude SSE keepalive", () => {

  it("emits output-side pings during silence and stops after the first real client byte", async () => {
    vi.useFakeTimers();
    const source = hangingBody();
    const output = createDisconnectAwareStream(
      { readable: source.body },
      streamController(FORMATS.CLAUDE),
      null,
      null,
      null,
      null,
      null,
      ANTHROPIC_PING_FRAME,
      1_000,
    );
    const reader = output.getReader();

    const firstRead = reader.read();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(decoder.decode((await firstRead).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));

    const secondRead = reader.read();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(decoder.decode((await secondRead).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));

    source.enqueue("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
    expect(decoder.decode((await reader.read()).value)).toContain("message_start");

    const afterRealByte = reader.read();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await settledRead(afterRealByte)).toBeUndefined();
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keys output keepalives off emitted Claude format", async () => {
    vi.useFakeTimers();
    const { upstream, reader } = await streamingResult(FORMATS.CLAUDE, FORMATS.OPENAI);

    const firstRead = reader.read();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(decoder.decode((await firstRead).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));

    await reader.cancel();
    upstream.close();
  });

  it("does not emit output keepalives for non-Claude emitted formats", async () => {
    vi.useFakeTimers();
    const { upstream, reader } = await streamingResult(FORMATS.OPENAI, FORMATS.OPENAI);
    const firstRead = reader.read();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await settledRead(firstRead)).toBeUndefined();

    await reader.cancel();
    upstream.close();
  });

  it("disables output keepalives when keepaliveMs is zero", async () => {
    vi.useFakeTimers();
    const source = hangingBody();
    const output = createDisconnectAwareStream(
      { readable: source.body },
      streamController(FORMATS.CLAUDE),
      null,
      null,
      null,
      null,
      null,
      ANTHROPIC_PING_FRAME,
      0,
    );
    const reader = output.getReader();
    const firstRead = reader.read();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await settledRead(firstRead)).toBeUndefined();

    await reader.cancel();
  });

  it("clears the ping interval when the stream disconnects", async () => {
    vi.useFakeTimers();
    const source = hangingBody();
    let connected = true;
    const controller = {
      isConnected: () => connected,
      handleComplete: vi.fn(),
      handleError: vi.fn(),
      handleDisconnect: vi.fn(),
    };
    const reader = createDisconnectAwareStream(
      { readable: source.body },
      controller,
      null,
      null,
      null,
      null,
      null,
      ANTHROPIC_PING_FRAME,
      1_000,
    ).getReader();

    const pending = reader.read();
    connected = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    await reader.cancel();
  });
});
