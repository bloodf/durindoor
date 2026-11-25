import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createStreamController, pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { createTerminalTracker } from "../../open-sse/utils/streamTerminal.js";

const frame = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n';

function errorPayload(text) {
  const data = text.split("event: error\ndata: ")[1];
  return JSON.parse(data.split("\n")[0]);
}

afterEach(() => vi.useRealTimers());

describe("port(upstream) #5276: a stalled upstream ends a Claude stream with a retryable error", () => {
  it("delivers earlier frames, then an overloaded_error, when upstream goes silent", async () => {
    vi.useFakeTimers();
    const controller = createStreamController({ provider: "antigravity", model: "m", log: { line() {}, errorLine() {} } });
    // Like fetch, the upstream body errors when the stall watchdog aborts the request.
    const upstream = new ReadableStream({
      start(source) {
        source.enqueue(new TextEncoder().encode(frame));
        controller.signal.addEventListener("abort", () => source.error(new DOMException("aborted", "AbortError")));
      },
    });
    const reader = pipeWithDisconnect(new Response(upstream), new TransformStream(), controller,
      null, 20, createTerminalTracker(FORMATS.CLAUDE)).getReader();
    const decoder = new TextDecoder();

    expect(decoder.decode((await reader.read()).value)).toBe(frame);
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(20);

    expect(errorPayload(decoder.decode((await pending).value))).toMatchObject({
      type: "error",
      error: { type: "overloaded_error" },
    });
    expect((await reader.read()).done).toBe(true);
  });

  it("marks an early upstream end retryable too", () => {
    const bytes = createTerminalTracker(FORMATS.CLAUDE).buildRecoveryBytes();
    expect(errorPayload(new TextDecoder().decode(bytes)).error.type).toBe("overloaded_error");
  });
});
