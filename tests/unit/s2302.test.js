import { describe, expect, it, vi } from "vitest";
import { createSseFrameDispatcher } from "../../open-sse/utils/sseFrames.js";

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
