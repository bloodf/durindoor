import { describe, expect, it, vi } from "vitest";
import { createSseFrameDispatcher } from "../../open-sse/utils/sseFrames.js";
import { createEmptyTerminalGuard } from "../../open-sse/utils/emptyStreamTerminal.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";
import { createTimelineFrameObserver } from "../../open-sse/handlers/chatCore/timelineFrameObserver.js";
import { createClientFrameFramer } from "../../open-sse/handlers/chatCore/proxyTimelineFrame.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();
function splitUtf8(text) {
  const bytes = encoder.encode(text);
  const split = bytes.indexOf(0xc3) + 1;
  return [bytes.slice(0, split), bytes.slice(split)];
}
async function guarded(chunks, format, snapshot = { content: "answer" }) {
  const source = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } });
  return new Uint8Array(await new Response(source.pipeThrough(
    createEmptyTerminalGuard(format, () => true, () => snapshot),
  )).arrayBuffer());
}

describe("shared SSE frame dispatch", () => {
  it.each([
    [FORMATS.OPENAI, ': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"café"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'],
    [FORMATS.CLAUDE, ': keepalive\n\nevent: content_block_delta\ndata: {"delta":{"text":"café"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'],
    [FORMATS.GEMINI, ': keepalive\n\ndata: {"candidates":[{"content":{"parts":[{"text":"café"}]},"finishReason":"STOP"}]}\n\n'],
  ])("preserves %s client bytes across a split UTF-8 character", async (format, text) => {
    expect(await guarded(splitUtf8(text), format)).toEqual(encoder.encode(text));
  });

  it("decodes each chunk once and shares the same parsed frame with observers", () => {
    const decoder = new TextDecoder();
    const decode = vi.spyOn(decoder, "decode");
    const first = vi.fn();
    const second = vi.fn();
    const dispatcher = createSseFrameDispatcher([first, second], { decoder });
    const chunks = splitUtf8('data: {"text":"café"}\n\n');
    for (const chunk of chunks) dispatcher.push(chunk);
    expect(decode).toHaveBeenCalledTimes(chunks.length);
    dispatcher.flush();
    expect(decode).toHaveBeenCalledTimes(chunks.length + 1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0]).toBe(first.mock.calls[0][0]);
    expect(first.mock.calls[0][0].payload).toEqual({ text: "café" });
  });

  it("preserves plain JSON wire text for observers", () => {
    const observed = [];
    const dispatcher = createSseFrameDispatcher([(frame) => observed.push(frame)]);
    dispatcher.push(encoder.encode('{"error":{"message":"provider failure"}}\n\n'));
    dispatcher.flush();
    expect(observed[0].wire).toBe('{"error":{"message":"provider failure"}}\n\n');
    expect(observed[0].payload).toEqual({ error: { message: "provider failure" } });
  });

  it("still replaces an empty success with the stream error", async () => {
    const result = await guarded([encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')], FORMATS.OPENAI, {});
    const text = new TextDecoder().decode(result);
    expect(text).toContain("Provider returned empty content");
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
  });
});

describe("shared SSE observations", () => {
  it.each([
    ['OpenAI', 'data: {"choices":[{"delta":{"content":"olá"}}]}\n\ndata: [DONE]\n\n'],
    ['Claude', 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"olá"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'],
    ['Gemini', 'data: {"candidates":[{"content":{"parts":[{"text":"olá"}]},"finishReason":"STOP"}]}\n\n'],
  ])("forwards %s bytes unchanged and shares decoded frames", (_name, fixture) => {
    const bytes = new TextEncoder().encode(': keepalive\n\n' + fixture);
    const split = bytes.indexOf(0xc3) + 1;
    const chunks = [bytes.slice(0, split), bytes.slice(split)];
    const decoder = new TextDecoder();
    const decode = vi.spyOn(decoder, 'decode');
    const first = [];
    const second = [];
    const dispatcher = createSseFrameDispatcher([
      frame => first.push(frame), frame => second.push(frame),
    ], { decoder });
    const forwarded = [];
    for (const chunk of chunks) {
      dispatcher.push(chunk);
      forwarded.push(...chunk);
    }
    dispatcher.flush();
    expect(new Uint8Array(forwarded)).toEqual(bytes);
    expect(decode).toHaveBeenCalledTimes(chunks.length + 1);
    expect(first[0].hasData).toBe(false);
    expect(first.some(frame => JSON.stringify(frame.payload ?? null).includes('olá'))).toBe(true);
    expect(first.length).toBeGreaterThan(1);
    first.forEach((frame, index) => expect(frame).toBe(second[index]));
  });
});

async function observingPipeline(chunks, format, { snapshot = { content: "answer" }, record = () => {} } = {}) {
  const source = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } });
  const guardedStream = source.pipeThrough(createEmptyTerminalGuard(format, () => true, () => snapshot));
  const timeline = createTimelineFrameObserver({ format: "sse-lines", onFrame: record });
  const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
  const readable = createDisconnectAwareStream(
    { readable: guardedStream }, controller, null, createTerminalTracker(format),
    (bytes, batch) => timeline.push(bytes, batch),
    (batch) => timeline.flush(batch), (batch) => timeline.flush(batch),
  );
  const bytes = new Uint8Array(await new Response(readable).arrayBuffer());
  return { bytes, controller };
}

describe("SSE observations across guard, tracker and timeline", () => {
  it.each([
    [FORMATS.OPENAI, 'data: {"choices":[{"delta":{"content":"café"}}]}\n\ndata: [DONE]\n\n'],
    [FORMATS.CLAUDE, 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"café"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'],
    [FORMATS.GEMINI, 'data: {"candidates":[{"content":{"parts":[{"text":"café"}]},"finishReason":"STOP"}]}\n\n'],
  ])("shares %s observations without decoding or parsing them again", async (format, fixture) => {
    const text = ': keepalive\n\n' + fixture;
    const chunks = splitUtf8(text);
    const expectedEvents = [];
    const legacy = createClientFrameFramer({ format: "sse-lines", onFrame: (frame) => expectedEvents.push(frame) });
    legacy.push(text);
    legacy.flush();
    const events = [];
    const decode = vi.spyOn(TextDecoder.prototype, "decode");
    const parse = vi.spyOn(JSON, "parse");
    try {
      const { bytes, controller } = await observingPipeline(chunks, format, { record: (frame) => events.push(frame) });
      expect(bytes).toEqual(encoder.encode(text));
      expect(events).toEqual(expectedEvents);
      expect(controller.handleComplete).toHaveBeenCalledTimes(1);
      expect(controller.handleError).not.toHaveBeenCalled();
      expect(decode.mock.calls.filter(([bytes]) => bytes?.byteLength > 0)).toHaveLength(chunks.length);
      const payloads = fixture.split("\n").filter((line) => line.startsWith("data: {")).map((line) => line.slice(6));
      for (const payload of payloads) expect(parse.mock.calls.filter(([text]) => text === payload)).toHaveLength(1);
    } finally {
      decode.mockRestore();
      parse.mockRestore();
    }
  });

  it("records the replacement error and DONE once for an empty response", async () => {
    const events = [];
    const { bytes } = await observingPipeline([
      encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),
    ], FORMATS.OPENAI, { snapshot: {}, record: (frame) => events.push(frame) });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Provider returned empty content");
    expect(events).toHaveLength(2);
    expect(events[0]).toContain("Provider returned empty content");
    expect(events[1]).toBe("data: [DONE]");
  });

  it("keeps client bytes when a timeline observer throws", async () => {
    const text = 'data: {"choices":[{"delta":{"content":"café"}}]}\n\ndata: [DONE]\n\n';
    const { bytes } = await observingPipeline(splitUtf8(text), FORMATS.OPENAI, { record() { throw new Error("timeline unavailable"); } });
    expect(bytes).toEqual(encoder.encode(text));
  });
});

describe("timeline frame compatibility", () => {
  it.each(["sse", "sse-lines", "ndjson"])("retains %s records across shared batches and abort tails", (format) => {
    const text = format === "ndjson" ? '{"text":"café"}\r\n{"tail":true}' : ': keepalive\r\n\r\nevent: delta\r\ndata: {"text":"café"}\r\n\r\ndata: trailing';
    const expected = [];
    const legacy = createClientFrameFramer({ format, onFrame: (frame) => expected.push(frame) });
    const actual = [];
    const timeline = createTimelineFrameObserver({ format, onFrame: (frame) => actual.push(frame) });
    const dispatcher = createSseFrameDispatcher();
    for (const chunk of splitUtf8(text)) {
      legacy.push(chunk);
      timeline.push(chunk, dispatcher.push(chunk));
    }
    legacy.flush();
    timeline.flush(dispatcher.flush());
    expect(actual).toEqual(expected);
  });
});

it("retains legacy line-only OpenAI finish reasons without adding recovery bytes", async () => {
  const text = 'data: {"choices":[{"delta":{"content":"café"}}]}\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n';
  const events = [];
  const { bytes, controller } = await observingPipeline(splitUtf8(text), FORMATS.OPENAI, { record: (frame) => events.push(frame) });
  expect(bytes).toEqual(encoder.encode(text));
  expect(events).toEqual(text.trimEnd().split("\n"));
  expect(controller.handleError).not.toHaveBeenCalled();
});

it.each([
  [FORMATS.OPENAI, 'data: [DONE]'],
  [FORMATS.CLAUDE, 'event: message_stop\ndata: {"type":"message_stop"}'],
])("retains %s trailing terminal observations on a network close", async (format, text) => {
  let sent = false;
  const source = new ReadableStream({ pull(controller) {
    if (!sent) { sent = true; controller.enqueue(encoder.encode(text)); }
    else controller.error(new Error("socket hang up"));
  } });
  const events = [];
  const timeline = createTimelineFrameObserver({ format: "sse", onFrame: (frame) => events.push(frame) });
  const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
  const stream = createDisconnectAwareStream({ readable: source }, controller, null, createTerminalTracker(format),
    (bytes, batch) => timeline.push(bytes, batch), (batch) => timeline.flush(batch), (batch) => timeline.flush(batch));
  expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(encoder.encode(text));
  expect(events).toEqual([text]);
});

it("keeps canonical timeline framing when recovery follows an unterminated frame", async () => {
  const text = 'data: {"choices":[{"delta":{"content":"café"}}]}';
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(text));
    controller.close();
  } });
  const events = [];
  const timeline = createTimelineFrameObserver({ format: "sse", onFrame: (frame) => events.push(frame) });
  const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
  const stream = createDisconnectAwareStream({ readable: source }, controller, null, createTerminalTracker(FORMATS.OPENAI),
    (bytes, batch) => timeline.push(bytes, batch), (batch) => timeline.flush(batch), (batch) => timeline.flush(batch));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const expected = [];
  const legacy = createClientFrameFramer({ format: "sse", onFrame: (frame) => expected.push(frame) });
  legacy.push(bytes);
  legacy.flush();
  expect(events).toEqual(expected);
  expect(events).toHaveLength(2);
  expect(events[0]).toContain("upstream_stream_incomplete");
  expect(events[1]).toBe("data: [DONE]");
});
