import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";
import { buildAbortedResponsesTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeController() {
  return {
    isConnected: vi.fn(() => true),
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
  };
}

async function drainWithTracker(chunks, format) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const streamController = makeController();
  const output = createDisconnectAwareStream(
    { readable: source, writable: { getWriter: () => ({ abort: vi.fn(() => Promise.resolve()) }) } },
    streamController,
    null,
    createTerminalTracker(format),
  );
  return { text: await new Response(output).text(), streamController };
}

describe("client-facing terminal recovery", () => {
  it.each([
    [FORMATS.OPENAI, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n", "data: [DONE]", "upstream_stream_incomplete"],
    [FORMATS.CLAUDE, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\"}\n\n", "event: error", "Upstream stream ended before completing"],
    [FORMATS.OPENAI_RESPONSES, "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\"}\n\n", "data: [DONE]", "stream_disconnected"],
  ])("adds error frame and terminator after incomplete %s EOF", async (format, partial, terminator, errorMarker) => {
    const { text, streamController } = await drainWithTracker([partial], format);

    expect(text).toContain(partial);
    expect(text).toContain(errorMarker);
    expect(text).toContain(terminator);
    expect(streamController.handleError).toHaveBeenCalledOnce();
  });

  it("leaves a completed OpenAI stream untouched", async () => {
    const terminal = "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    const { text, streamController } = await drainWithTracker([terminal], FORMATS.OPENAI);

    expect(text).toBe(terminal);
    expect(streamController.handleComplete).toHaveBeenCalledOnce();
    expect(streamController.handleError).not.toHaveBeenCalled();
  });

  it("does not double-decorate an already errored Claude stream", async () => {
    const error = "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"upstream failed\"}}\n\n";
    const { text, streamController } = await drainWithTracker([error], FORMATS.CLAUDE);

    expect(text).toBe(error);
    expect(text).not.toContain("Upstream stream ended before completing");
    expect(streamController.handleComplete).toHaveBeenCalledOnce();
    expect(streamController.handleError).not.toHaveBeenCalled();
  });

  it("Responses passthrough: clean EOF with no terminal event gets recovered like other formats", async () => {
    // Mirrors production wiring in streamingHandler.js: passthrough streams still
    // get both onAbortTerminal (abort/catch path) AND terminalTracker (clean-EOF path).
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\"}\n\n"));
        controller.close();
      },
    });
    const streamController = makeController();
    const output = createDisconnectAwareStream(
      { readable: source, writable: { getWriter: () => ({ abort: vi.fn(() => Promise.resolve()) }) } },
      streamController,
      buildAbortedResponsesTerminalBytes,
      createTerminalTracker(FORMATS.OPENAI_RESPONSES),
    );
    const text = await new Response(output).text();

    expect(text).toContain("response.output_text.delta");
    expect(text).toContain("response.failed");
    expect(text).toContain("stream_disconnected");
    expect(text).toContain("data: [DONE]");
    expect(streamController.handleError).toHaveBeenCalledOnce();
    expect(streamController.handleComplete).not.toHaveBeenCalled();
  });

  it.each([
    [FORMATS.OPENAI, "upstream_stream_incomplete", "data: [DONE]"],
    [FORMATS.CLAUDE, "Upstream stream ended before completing", "event: error"],
  ])("emits client recovery bytes on %s ECONNRESET", async (format, errorMarker, terminator) => {
    // Mirrors network-reset path: transform pulls a chunk, then upstream errors
    // with ECONNRESET mid-stream. No real terminal has been sent; the client
    // tracker should still synthesize one before close.
    const partial = format === FORMATS.OPENAI
      ? "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n"
      : "event: content_block_delta\ndata: {\"type\":\"content_block_delta\"}\n\n";
    let firstRead = true;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(partial));
      },
      pull(controller) {
        if (firstRead) { firstRead = false; return; }
        controller.error(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      },
    });
    const streamController = makeController();
    const output = createDisconnectAwareStream(
      { readable: source, writable: { getWriter: () => ({ abort: vi.fn(() => Promise.resolve()) }) } },
      streamController,
      null,
      createTerminalTracker(format),
    );
    const text = await new Response(output).text();

    expect(text).toContain(partial);
    expect(text).toContain(errorMarker);
    expect(text).toContain(terminator);
    expect(streamController.handleError).toHaveBeenCalled();
  });

  it("does not decorate a completed Responses stream after ECONNRESET", async () => {
    let firstRead = true;
    const completed = "event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n";
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(completed));
      },
      pull(controller) {
        if (firstRead) { firstRead = false; return; }
        controller.error(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      },
    });
    const output = createDisconnectAwareStream(
      { readable: source, writable: { getWriter: () => ({ abort: vi.fn(() => Promise.resolve()) }) } },
      makeController(),
      buildAbortedResponsesTerminalBytes,
      createTerminalTracker(FORMATS.OPENAI_RESPONSES),
    );
    const text = await new Response(output).text();

    expect(text).toBe(completed);
    expect(text).not.toContain("response.failed");
    expect(text).not.toContain("data: [DONE]");
  });
});
