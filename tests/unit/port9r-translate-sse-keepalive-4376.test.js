import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { ANTHROPIC_PING_FRAME } from "../../open-sse/utils/earlyStreamKeepalive.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function chunk(delta, finish = null) {
  return `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

function controlled() {
  let upstream;
  const body = new ReadableStream({ start(controller) { upstream = controller; } });
  return { body, push: (text) => upstream.enqueue(encoder.encode(text)), close: () => upstream.close() };
}

function translate(sourceFormat) {
  return createSSETransformStreamWithLogger(FORMATS.OPENAI, sourceFormat, "openrouter", null, null, "m");
}

describe("decolua/9router#4376 - translate mode relays SSE comment heartbeats", () => {
  afterEach(() => vi.useRealTimers());

  it.each([FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES])("sends a neutral keepalive before any content to a %s client", async (sourceFormat) => {
    const source = controlled();
    const reader = source.body.pipeThrough(translate(sourceFormat)).getReader();
    source.push(": OPENROUTER PROCESSING\n\n");

    expect(decoder.decode((await reader.read()).value)).toBe(": keepalive\n\n");
    await reader.cancel();
  });

  it("keeps the translated reply intact after heartbeats", async () => {
    const source = controlled();
    const output = new Response(source.body.pipeThrough(translate(FORMATS.CLAUDE))).text();
    source.push(": ping\n\n: ping\n\n");
    source.push(chunk({ role: "assistant", content: "hello" }));
    source.push(chunk({}, "stop"));
    source.push("data: [DONE]\n\n");
    source.close();
    const text = await output;

    expect(text.match(/^: keepalive$/gm)).toHaveLength(2);
    expect(text).toContain('"text":"hello"');
    expect(text).toContain("event: message_stop");
  });

  it("leaves the Claude ping armed after a relayed heartbeat", async () => {
    vi.useFakeTimers();
    const source = controlled();
    const streamController = { signal: new AbortController().signal, startTime: 0, isConnected: () => true, handleComplete() {}, handleError() {}, handleDisconnect() {}, abort() {} };
    const reader = pipeWithDisconnect({ body: source.body }, translate(FORMATS.CLAUDE), streamController, null, 60_000, null, null, null, null, ANTHROPIC_PING_FRAME, 100, 60_000).getReader();
    source.push(": ping\n\n");
    expect(decoder.decode((await reader.read()).value)).toBe(": keepalive\n\n");

    const next = reader.read();
    await vi.advanceTimersByTimeAsync(100);

    expect(decoder.decode((await next).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));
    await reader.cancel();
  });
});
