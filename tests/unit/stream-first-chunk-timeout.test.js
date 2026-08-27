import { afterEach, describe, expect, it, vi } from "vitest";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

const TTFT_TIMEOUT_MS = 25;
const STALL_TIMEOUT_MS = 60_000;

function createController() {
  return {
    signal: undefined,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    handleActivity: vi.fn(),
    abort: vi.fn(),
  };
}

function pipe(body, streamController, terminalTracker = null) {
  return pipeWithDisconnect(
    new Response(body),
    new TransformStream(),
    streamController,
    null,
    STALL_TIMEOUT_MS,
    terminalTracker,
    null,
    null,
    null,
    null,
    0,
    TTFT_TIMEOUT_MS,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pipeWithDisconnect first-chunk timeout", () => {
  it("aborts when upstream yields no bytes before the TTFT deadline", async () => {
    vi.useFakeTimers();
    const streamController = createController();
    const body = new ReadableStream({ pull: () => new Promise(() => {}) });

    pipe(body, streamController);
    await vi.advanceTimersByTimeAsync(TTFT_TIMEOUT_MS);

    expect(streamController.handleError).toHaveBeenCalledWith(
      new Error(`stream ttft timeout (${TTFT_TIMEOUT_MS}ms)`),
    );
    expect(streamController.abort).toHaveBeenCalledTimes(1);
  });

  it("clears the TTFT timer after the first upstream byte", async () => {
    vi.useFakeTimers();
    const streamController = createController();
    const terminalTracker = {
      observeClientFrame: vi.fn(),
      buildRecoveryBytes: vi.fn(() => null),
    };
    let sent = false;
    const body = new ReadableStream({
      pull(controller) {
        if (sent) return new Promise(() => {});
        sent = true;
        controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
      },
    });
    const reader = pipe(body, streamController, terminalTracker).getReader();

    expect((await reader.read()).done).toBe(false);
    expect(terminalTracker.observeClientFrame).toHaveBeenCalledWith("data: ready\n\n");
    await vi.advanceTimersByTimeAsync(TTFT_TIMEOUT_MS);

    expect(streamController.handleError).not.toHaveBeenCalled();
    expect(streamController.abort).not.toHaveBeenCalled();
    await reader.cancel();
  });
});
