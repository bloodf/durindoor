import { describe, expect, it, vi } from "vitest";
import { createSseFrameDispatcher } from "../../open-sse/utils/sseFrames.js";
import { createEmptyTerminalGuard } from "../../open-sse/utils/emptyStreamTerminal.js";
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
