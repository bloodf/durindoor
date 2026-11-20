// #1073 review — a completed Antigravity turn closes on the provider terminal.
//
// Review fixture: `/tmp/durin-review.JnBE5e/replay terminal 'base head'`.
// The synthetic upstream emits a provider STOP with usage and intentionally
// never sends EOF. Base `bc7dd39e48e0` produced one stop, one usage record,
// no discard and no error; the shipped tree produced the same stop and usage
// and then a status-neutral stall error, because #2073 turned every
// byte-silent upstream into a failure — including a stream that had already
// answered.
//
// A confirmed provider terminal completes the response: the attempt closes the
// client stream itself instead of waiting for an upstream EOF that may never
// come. A stalled attempt that never confirmed a terminal keeps its existing
// status-neutral failure (settle the reservation, no retry, no cooldown), and
// an explicit upstream error keeps its own retry/quota handling.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The provider terminal: content, finish reason and usage in one Antigravity
// frame ({response:{candidates:[...],usageMetadata:{...}}}).
const TERMINAL_FRAME = {
  response: {
    candidates: [{ content: { role: "model", parts: [{ text: "Answer" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  },
};

// A trailing usage frame in the same provider framing: no candidates, only the
// usage counters. It can arrive after the terminal.
const LATE_USAGE_FRAME = {
  response: { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } },
};

const QUOTA_ERROR_FRAME = {
  response: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota exhausted" } },
};

const sseLine = (frame) => `data: ${JSON.stringify(frame)}\n\n`;

// Upstream body that emits the given frames and then either closes (a normal
// upstream EOF) or holds the socket open forever, like the Antigravity relays
// that answer and never close.
function upstreamBody(frames, { close = false } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(sseLine(frame)));
      if (close) controller.close();
    },
  });
}

// The review harness: guard the upstream bytes, translate them for an OpenAI
// client and record what the client actually saw.
async function replay(frames, { close = false, stallTimeoutMs = 100, baseDelayMs = 1 } = {}) {
  const discards = [];
  const usage = [];
  const onExhausted = vi.fn();
  const body = upstreamBody(frames, { close });
  // A retry replays the identical request, so it serves the same frames.
  const reexecute = vi.fn(async () => upstreamBody(frames, { close: true }));
  const guarded = createEmptyRetryStream({
    body,
    reexecute,
    onAttemptDiscarded: (_attemptBody, reason) => discards.push(reason),
    onExhausted,
    stallTimeoutMs,
    baseDelayMs,
  });
  const transform = createSSEStream({
    mode: "translate",
    targetFormat: FORMATS.ANTIGRAVITY,
    sourceFormat: FORMATS.OPENAI,
    provider: "antigravity",
    onStreamComplete: (_completion, tokens) => usage.push(tokens.total_tokens),
  });
  const reader = guarded.pipeThrough(transform).getReader();
  let wire = "";
  let error = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      wire += decoder.decode(value, { stream: true });
    }
  } catch (e) {
    error = e.message;
  }
  return {
    wire,
    error,
    discards,
    usage,
    retries: reexecute.mock.calls.length,
    exhausted: onExhausted.mock.calls.length,
    stops: (wire.match(/"finish_reason":"stop"/g) || []).length,
  };
}

describe("#1073 — a completed Antigravity turn closes on the provider terminal", () => {
  it("completes a provider STOP with usage when the upstream never sends EOF", async () => {
    const result = await replay([TERMINAL_FRAME]);

    expect(result.stops).toBe(1);
    expect(result.usage).toEqual([5]);
    expect(result.discards).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.retries).toBe(0);
    expect(result.exhausted).toBe(0);
  });

  it("completes the same turn when the upstream does send EOF", async () => {
    const result = await replay([TERMINAL_FRAME], { close: true });

    expect(result.stops).toBe(1);
    expect(result.usage).toEqual([5]);
    expect(result.discards).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("closes the completed turn before the raw-byte stall budget expires", async () => {
    const stallTimeoutMs = 3000;
    const startedAt = Date.now();
    const result = await replay([TERMINAL_FRAME], { stallTimeoutMs });
    const elapsed = Date.now() - startedAt;

    expect(result.error).toBeNull();
    expect(result.stops).toBe(1);
    expect(elapsed).toBeLessThan(stallTimeoutMs);
  });

  it("forwards late usage bytes that arrive after the provider terminal", async () => {
    const discards = [];
    const body = upstreamBody([TERMINAL_FRAME, LATE_USAGE_FRAME]);
    const guarded = createEmptyRetryStream({
      body,
      reexecute: vi.fn(),
      onAttemptDiscarded: (_attemptBody, reason) => discards.push(reason),
      stallTimeoutMs: 100,
    });
    const reader = guarded.getReader();
    let wire = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      wire += decoder.decode(value, { stream: true });
    }

    expect(wire).toContain("STOP");
    expect(wire).toContain("\"totalTokenCount\":5");
    expect(wire.split("data: ").length - 1).toBe(2);
    expect(discards).toEqual([]);
  });

  it("still fails a byte-silent attempt that never confirmed a terminal", async () => {
    const body = new ReadableStream({});
    const onAttemptDiscarded = vi.fn();
    const reexecute = vi.fn();
    const onExhausted = vi.fn();
    const guarded = createEmptyRetryStream({
      body,
      reexecute,
      onAttemptDiscarded,
      onExhausted,
      stallTimeoutMs: 20,
    });

    await expect(new Response(guarded).text()).rejects.toThrow("stream stall timeout");
    expect(onAttemptDiscarded).toHaveBeenCalledWith(body, "stall", { final: true });
    expect(reexecute).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("still surfaces an explicit upstream error instead of a stall", async () => {
    const onExhausted = vi.fn();
    const reexecute = vi.fn(async () => upstreamBody([QUOTA_ERROR_FRAME], { close: true }));
    const guarded = createEmptyRetryStream({
      body: upstreamBody([QUOTA_ERROR_FRAME]),
      reexecute,
      onExhausted,
      stallTimeoutMs: 20,
      baseDelayMs: 1,
    });
    const reader = guarded.getReader();
    let wire = "";
    let error = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        wire += decoder.decode(value, { stream: true });
      }
    } catch (e) {
      error = e.message;
    }

    expect(error).toBeNull();
    expect(reexecute).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0][1].upstreamError.status).toBe("RESOURCE_EXHAUSTED");
    expect(wire).toContain("RESOURCE_EXHAUSTED");
    expect(wire).not.toContain("stream stall timeout");
  });
});
