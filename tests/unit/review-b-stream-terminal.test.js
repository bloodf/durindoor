import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createEmptyTerminalGuard } from "../../open-sse/utils/emptyStreamTerminal.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { createTerminalTracker, emittedFormatTerminalKind } from "../../open-sse/utils/streamTerminal.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function dataFrame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function eventFrame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const content = dataFrame({ choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] });
const stop = dataFrame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });

function framesThenReset(frames) {
  let index = 0;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frames[0]));
      index = 1;
    },
    pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index]));
        index += 1;
        return;
      }
      controller.error(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    },
  });
}

function streamController() {
  return {
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    handleActivity: vi.fn(),
    abort: vi.fn(),
    signal: undefined,
    startTime: Date.now(),
  };
}

async function pipeReset(frames) {
  const output = pipeWithDisconnect(
    { body: framesThenReset(frames) },
    new TransformStream(),
    streamController(),
    null,
    60_000,
    createTerminalTracker(FORMATS.OPENAI),
  );
  return new Response(output).text();
}

describe("emitted format terminal", () => {
  it("treats OpenAI finish_reason as not terminal and the real end events as terminal", () => {
    expect(emittedFormatTerminalKind(FORMATS.OPENAI, stop)).toBeNull();
    expect(emittedFormatTerminalKind(FORMATS.OPENAI, dataFrame({
      choices: [{ index: 0, delta: {}, finish_reason: "length" }],
    }))).toBeNull();
    expect(emittedFormatTerminalKind(FORMATS.OPENAI, dataFrame({
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    }))).toBeNull();
    expect(emittedFormatTerminalKind(FORMATS.OPENAI, "data: [DONE]\n\n")).toBe("done");
    expect(emittedFormatTerminalKind(FORMATS.OPENAI, dataFrame({ error: { message: "failed" } }))).toBe("failure");
    expect(emittedFormatTerminalKind(FORMATS.CLAUDE, eventFrame("message_stop", { type: "message_stop" }))).toBe("success");
    expect(emittedFormatTerminalKind(FORMATS.CLAUDE, eventFrame("content_block_delta", { type: "content_block_delta" }))).toBeNull();
    expect(emittedFormatTerminalKind(FORMATS.OPENAI_RESPONSES, eventFrame("response.completed", { type: "response.completed" }))).toBe("success");
    expect(emittedFormatTerminalKind(FORMATS.OPENAI_RESPONSES, eventFrame("response.failed", { type: "response.failed" }))).toBe("failure");
    expect(emittedFormatTerminalKind(FORMATS.GEMINI, dataFrame({
      candidates: [{ index: 0, finishReason: "STOP" }],
    }))).toBe("success");
    expect(emittedFormatTerminalKind(FORMATS.GEMINI, dataFrame({
      candidates: [{ index: 0, finishReason: "STOP" }, { index: 1 }],
    }))).toBeNull();
    expect(emittedFormatTerminalKind(FORMATS.GEMINI, dataFrame({
      candidates: [{ index: 0, content: { parts: [{ text: "partial" }] } }],
    }))).toBeNull();
  });

  it.each(["stop", "length", "tool_calls"])("still recovers after an OpenAI finish_reason %s frame", (reason) => {
    const tracker = createTerminalTracker(FORMATS.OPENAI);
    tracker.observeClientFrame(content);
    tracker.observeClientFrame(dataFrame({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }));
    const bytes = tracker.buildRecoveryBytes();
    expect(bytes).not.toBeNull();
    expect(decoder.decode(bytes)).toContain("data: [DONE]");
  });

  it("does not recover once the format end has been seen", () => {
    const openai = createTerminalTracker(FORMATS.OPENAI);
    openai.observeClientFrame(stop);
    openai.observeClientFrame("data: [DONE]\n\n");
    expect(openai.buildRecoveryBytes()).toBeNull();

    const claude = createTerminalTracker(FORMATS.CLAUDE);
    claude.observeClientFrame(eventFrame("message_stop", { type: "message_stop" }));
    expect(claude.buildRecoveryBytes()).toBeNull();

    const completed = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    completed.observeClientFrame(eventFrame("response.completed", { type: "response.completed" }));
    expect(completed.buildRecoveryBytes()).toBeNull();

    const failed = createTerminalTracker(FORMATS.OPENAI_RESPONSES);
    failed.observeClientFrame(eventFrame("response.failed", { type: "response.failed" }));
    expect(failed.buildRecoveryBytes()).toBeNull();
  });
});

describe("finish_reason drop recovery", () => {
  it("appends [DONE] when the upstream resets after finish_reason stop", async () => {
    const text = await pipeReset([content, stop]);

    expect(text).toContain(content);
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("upstream_stream_incomplete");
    expect(text).toContain("data: [DONE]");
    expect(text.indexOf('"finish_reason":"stop"')).toBeLessThan(text.indexOf("data: [DONE]"));
  });

  it("does not append a second terminal when [DONE] already arrived", async () => {
    const done = "data: [DONE]\n\n";
    const text = await pipeReset([content, stop, done]);

    expect(text).toContain(done);
    expect(text).not.toContain("upstream_stream_incomplete");
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });
});

describe("empty terminal guard shares the format end", () => {
  it("still replaces an empty OpenAI stop once [DONE] arrives", async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(stop));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const text = await new Response(source.pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI, () => true, () => ({})))).text();
    expect(text).toContain("Provider returned empty content");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(text.indexOf('"error"')).toBeLessThan(text.indexOf("[DONE]"));
  });

  it("forwards a Responses failure instead of treating it as an empty success", async () => {
    const frame = eventFrame("response.failed", { type: "response.failed", response: { status: "failed" } });
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    const text = await new Response(source.pipeThrough(createEmptyTerminalGuard(FORMATS.OPENAI_RESPONSES, () => true, () => ({})))).text();
    expect(text).toBe(frame);
    expect(text).not.toContain("Provider returned empty content");
  });
});
