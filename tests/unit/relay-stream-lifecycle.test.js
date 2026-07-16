// Port of diegosouzapw/OmniRoute#7093 "fix(relay): bound Bifrost stream lifetime".
// Locks relay SSE lifecycle semantics: the caller's timeout/abort signal stays
// live until body EOF, stream error, downstream cancel, or caller abort, and
// finalization runs exactly once (no leaked listeners on unconsumed bodies).
import { describe, it, expect, vi } from "vitest";
import {
  boundRelayStreamLifetime,
  isRelaySseResponse,
} from "../../open-sse/utils/relayStreamLifecycle.js";

const encoder = new TextEncoder();

function makeBody(chunks = ["data: a\n\n", "data: b\n\n"]) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function makeSseResponse(chunks) {
  return new Response(makeBody(chunks), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

async function drain(stream) {
  const reader = stream.getReader();
  const out = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("isRelaySseResponse", () => {
  it("accepts text/event-stream bodies and rejects JSON or missing bodies", () => {
    expect(isRelaySseResponse(makeSseResponse())).toBe(true);
    expect(
      isRelaySseResponse(new Response("{}", { headers: { "content-type": "application/json" } }))
    ).toBe(false);
    expect(isRelaySseResponse(new Response(null, { headers: { "content-type": "text/event-stream" } }))).toBe(false);
  });
});

describe("boundRelayStreamLifetime", () => {
  it("finalizes once with no error on normal EOF after delivering every chunk", async () => {
    const onFinalize = vi.fn();
    const signal = new AbortController().signal;
    const stream = boundRelayStreamLifetime(makeBody(), { signal, onFinalize });
    const chunks = await drain(stream);
    expect(chunks).toHaveLength(2);
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize).toHaveBeenCalledWith(undefined);
  });

  it("finalizes once when the caller aborts while a pull is pending", async () => {
    const onFinalize = vi.fn();
    const controller = new AbortController();
    // Body that never delivers: the pull stays pending until abort.
    let canceledWith;
    const hangingBody = new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel(reason) {
        canceledWith = reason;
      },
    });
    const stream = boundRelayStreamLifetime(hangingBody, {
      signal: controller.signal,
      onFinalize,
    });
    const reader = stream.getReader();
    const pending = reader.read();
    controller.abort();
    // Abort surfaces as AbortError downstream, never as a clean EOF.
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize.mock.calls[0][0]).toMatchObject({ name: "AbortError" });
    expect(canceledWith).toMatchObject({ name: "AbortError" });
  });

  it("finalizes once when the caller aborts with NO consumer attached (no pending pull)", async () => {
    const onFinalize = vi.fn();
    const controller = new AbortController();
    let canceled = false;
    const body = new ReadableStream({
      start() {},
      cancel() {
        canceled = true;
      },
    });
    boundRelayStreamLifetime(body, { signal: controller.signal, onFinalize });
    controller.abort();
    await vi.waitFor(() => {
      expect(onFinalize).toHaveBeenCalledTimes(1);
    });
    expect(onFinalize.mock.calls[0][0]).toMatchObject({ name: "AbortError" });
    expect(canceled).toBe(true);
    // Listener removed: further abort-cycle on a new controller state is irrelevant,
    // but the same signal cannot re-fire — guard via second abort being a no-op.
    controller.abort();
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("finalizes once when downstream cancels, and does not fire again on later abort", async () => {
    const onFinalize = vi.fn();
    const controller = new AbortController();
    let upstreamCancelReason;
    const body = new ReadableStream({
      start() {},
      cancel(reason) {
        upstreamCancelReason = reason;
      },
    });
    const stream = boundRelayStreamLifetime(body, {
      signal: controller.signal,
      onFinalize,
    });
    const reader = stream.getReader();
    await reader.cancel("client-gone");
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize).toHaveBeenCalledWith("client-gone");
    expect(upstreamCancelReason).toBe("client-gone");
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("finalizes once with the error when the upstream body errors mid-stream", async () => {
    const onFinalize = vi.fn();
    const failure = new Error("upstream-reset");
    let pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode("data: a\n\n"));
          return;
        }
        controller.error(failure);
      },
    });
    const stream = boundRelayStreamLifetime(body, {
      signal: new AbortController().signal,
      onFinalize,
    });
    const reader = stream.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toBe(failure);
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize).toHaveBeenCalledWith(failure);
  });

  it("handles an already-aborted signal: cancels upstream, finalizes once, errors the stream", async () => {
    const onFinalize = vi.fn();
    const controller = new AbortController();
    let canceled = false;
    const body = new ReadableStream({
      start() {},
      cancel() {
        canceled = true;
      },
    });
    controller.abort();
    const stream = boundRelayStreamLifetime(body, {
      signal: controller.signal,
      onFinalize,
    });
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize.mock.calls[0][0]).toMatchObject({ name: "AbortError" });
    expect(canceled).toBe(true);
    const reader = stream.getReader();
    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("clears the relay timeout via onFinalize even when the body is never consumed", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let timeoutFired = false;
      const onFinalize = vi.fn();
      const tid = setTimeout(() => {
        timeoutFired = true;
        controller.abort(new Error("relay stream timeout"));
      }, 5000);
      const body = new ReadableStream({ start() {} });
      boundRelayStreamLifetime(body, {
        signal: controller.signal,
        onFinalize: (error) => {
          clearTimeout(tid);
          onFinalize(error);
        },
      });
      // Never consume: timeout fires, abort cancels the unread body, finalize
      // clears the timer exactly once. clearTimeout-after-fire is harmless.
      await vi.advanceTimersByTimeAsync(5000);
      expect(timeoutFired).toBe(true);
      await vi.waitFor(() => {
        expect(onFinalize).toHaveBeenCalledTimes(1);
      });
      expect(onFinalize.mock.calls[0][0]).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });
});
