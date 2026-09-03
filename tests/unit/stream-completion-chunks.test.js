import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function writeAndRead(writer, reader, text) {
  const write = writer.write(encoder.encode(text));
  const read = reader.read();
  const [, result] = await Promise.all([write, read]);
  return decoder.decode(result.value);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SSE completion chunk accumulation", () => {
  it("preserves long OpenAI content, reasoning, usage, TTFT, snapshots, and emitted bytes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    const ttftAt = Date.now();
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai",
      null,
      null,
      "gpt-test",
      "connection-1",
      { messages: [{ role: "user", content: "hello" }] },
      onComplete,
      null,
      FORMATS.OPENAI,
    );
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const frames = Array.from({ length: 128 }, (_, index) => ({
      id: "chatcmpl-long",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-test",
      choices: [{
        index: 0,
        delta: index % 2 === 0
          ? { content: `content-${index};` }
          : { reasoning_content: `thinking-${index};` },
        finish_reason: null,
      }],
    }));
    const content = frames.flatMap(frame => frame.choices.map(choice => choice.delta.content || "")).join("");
    const thinking = frames.flatMap(frame => frame.choices.map(choice => choice.delta.reasoning_content || "")).join("");
    let emitted = "";

    for (const frame of frames) {
      const line = `data: ${JSON.stringify(frame)}\n`;
      emitted += await writeAndRead(writer, reader, line);
    }

    expect(transform.getStreamSnapshot()).toMatchObject({ content, thinking, ttftAt });
    vi.setSystemTime(new Date("2026-09-01T12:00:05.000Z"));
    const usageFrame = { usage: { prompt_tokens: 7, completion_tokens: 128, total_tokens: 135 } };
    const usageLine = `data: ${JSON.stringify(usageFrame)}\n`;
    emitted += await writeAndRead(writer, reader, usageLine);
    emitted += await writeAndRead(writer, reader, "data: [DONE]\n");
    const close = writer.close();
    expect((await reader.read()).done).toBe(true);
    await close;

    expect(emitted).toBe(`${frames.map(frame => `data: ${JSON.stringify(frame)}\n`).join("")}${usageLine}data: [DONE]\n`);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual({ content, thinking });
    expect(onComplete.mock.calls[0][1]).toEqual(usageFrame.usage);
    expect(onComplete.mock.calls[0][2]).toBe(ttftAt);
    expect(transform.getStreamSnapshot()).toEqual({ content, thinking, usage: usageFrame.usage, ttftAt });
  });

  it("preserves ordered Gemini text and thinking at immediate completion and flush", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "gemini", null, null, "gemini-test", "connection-1", {}, onComplete,
    );
    const frames = [
      { candidates: [{ content: { parts: [{ text: "think-1", thought: true }, { text: "answer-1" }] } }] },
      { candidates: [{ content: { parts: [{ text: "think-2", thought: true }, { text: "answer-2" }] }, finishReason: "STOP" }] },
    ];
    const expectedOutput = frames.map(frame => `data: ${JSON.stringify(frame)}\n`).join("");
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(expectedOutput));
        controller.close();
      },
    });

    const output = await new Response(source.pipeThrough(transform)).text();

    expect(output).toBe(expectedOutput);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual({
      content: "answer-1answer-2",
      thinking: "think-1think-2",
    });
    expect(transform.getStreamSnapshot()).toMatchObject({
      content: "answer-1answer-2",
      thinking: "think-1think-2",
    });
  });


  it("completes once with an unterminated OpenAI flush tail", async () => {
    const onComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "openai", null, null, "gpt-test", "connection-1", {}, onComplete,
    );
    const frame = {
      id: "chatcmpl-tail",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-test",
      choices: [{ index: 0, delta: { content: "tail", reasoning_content: "thought" }, finish_reason: null }],
    };
    const input = `data: ${JSON.stringify(frame)}`;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(input));
        controller.close();
      },
    });

    const output = await new Response(source.pipeThrough(transform)).text();

    expect(output.startsWith(`${input}\n\n`)).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual({ content: "tail", thinking: "thought" });
    expect(transform.getStreamSnapshot()).toMatchObject({ content: "tail", thinking: "thought" });
  });
});
