// #1073 repair — the Antigravity post-terminal usage drain is bounded.
//
// The prerequisite gave a confirmed provider terminal a short trailing-byte
// drain window, so an upstream that answers and then holds the socket open
// closes the client stream instead of stalling. Two holes let that window
// grow without bound: the deadline was re-armed on every later terminal
// decision, and the drain's zero-delay timer lost the race against an
// upstream read that was already ready. A relay that repeated its terminal
// metadata could therefore keep a finished turn open for ever.
//
// The repair establishes the deadline once, on the first forwarded terminal,
// and checks it explicitly before every read. The fixture below is offline
// and finite: a fake clock, an upstream whose reads are always ready, and
// repeated terminal metadata.
import { describe, expect, it, vi, afterEach } from "vitest";
import "../translator/registerAll.js";
import { createEmptyRetryStream, TERMINAL_DRAIN_TIMEOUT_MS } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
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

// A repeated terminal metadata frame: the same terminal without content and
// with the same usage counters.
const REPEATED_TERMINAL_FRAME = {
  response: {
    candidates: [{ finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  },
};

// A trailing usage frame in the same provider framing: no candidates, only the
// usage counters. It is not a terminal decision.
const LATE_USAGE_FRAME = {
  response: { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } },
};

const sseLine = (frame) => `data: ${JSON.stringify(frame)}\n\n`;

// An upstream that never sends EOF and always has a ready read: every read
// hands over the next frame and advances the fake clock, so the drain window
// can only expire on the guard's own deadline check. `maxReads` keeps the
// fixture finite — a guard that never expires the window burns all of them.
function fakeUpstream(frames, { stepMs = 50, maxReads = 400 } = {}) {
  const state = { reads: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (state.reads >= maxReads) { controller.close(); return; }
      const frame = frames[Math.min(state.reads, frames.length - 1)];
      state.reads++;
      // Only the fake clock moves here, so the window expires on the deadline
      // check rather than on a timer.
      vi.advanceTimersByTime(stepMs);
      controller.enqueue(encoder.encode(sseLine(frame)));
    },
    cancel() { state.cancelled = true; },
  });
  return { body, state };
}

// The harness: guard the upstream bytes, optionally translate them for an
// OpenAI client, and record what the client actually saw.
async function replay(frames, { translate = true, stallTimeoutMs = 5000, baseDelayMs = 1 } = {}) {
  const upstream = fakeUpstream(frames);
  const discards = [];
  const usage = [];
  const onExhausted = vi.fn();
  const guarded = createEmptyRetryStream({
    body: upstream.body,
    reexecute: vi.fn(),
    onAttemptDiscarded: (_body, reason) => discards.push(reason),
    onExhausted,
    stallTimeoutMs,
    baseDelayMs,
  });
  const source = translate ?
  guarded.pipeThrough(createSSEStream({
    mode: "translate",
    targetFormat: FORMATS.ANTIGRAVITY,
    sourceFormat: FORMATS.OPENAI,
    provider: "antigravity",
    onStreamComplete: (_completion, tokens) => usage.push(tokens?.total_tokens),
  })) :
  guarded;
  const reader = source.getReader();
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
    exhausted: onExhausted.mock.calls.length,
    upstream: upstream.state,
    stops: (wire.match(/"finish_reason":"stop"/g) || []).length,
    frames: (wire.match(/data: /g) || []).length,
  };
}

// The fake clock drives the drain window, so it must be installed for the
// cases that measure it — and only for those.
function useFakeClock() {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("#1073 — the Antigravity terminal drain window is bounded", () => {
  it("does not let repeated terminal metadata extend the drain deadline", async () => {
    useFakeClock();
    const startedAt = Date.now();
    const result = await replay([TERMINAL_FRAME, REPEATED_TERMINAL_FRAME]);

    expect(result.error).toBeNull();
    expect(result.discards).toEqual([]);
    expect(result.exhausted).toBe(0);
    // The window expired instead of the upstream talking for ever.
    expect(result.upstream.reads).toBeLessThan(60);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(TERMINAL_DRAIN_TIMEOUT_MS + 100);
    // One completion, not one per repeated terminal frame.
    expect(result.stops).toBe(1);
  });

  it("closes the window even when every upstream read is ready", async () => {
    useFakeClock();
    const startedAt = Date.now();
    // No further terminal decision: only trailing usage frames. The drain's
    // timer must not lose the race against an already-ready read.
    const result = await replay([TERMINAL_FRAME, LATE_USAGE_FRAME]);

    expect(result.error).toBeNull();
    expect(result.discards).toEqual([]);
    expect(result.upstream.reads).toBeLessThan(60);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(TERMINAL_DRAIN_TIMEOUT_MS + 100);
    expect(result.stops).toBe(1);
  });

  it("keeps the usage that arrives inside the drain window", async () => {
    useFakeClock();
    const result = await replay([TERMINAL_FRAME, LATE_USAGE_FRAME], { translate: false });

    expect(result.error).toBeNull();
    // The terminal and the trailing usage frame both reached the client.
    expect(result.frames).toBeGreaterThan(1);
    expect(result.wire).toContain("\"totalTokenCount\":5");
    // A repeated terminal does not repeat the completion.
    expect(result.wire.match(/finishReason/g) || []).toHaveLength(1);
    // The completed stream releases the upstream reader.
    expect(result.upstream.cancelled).toBe(true);
  });

  it("keeps the existing end reason for an unrelated read error", async () => {
    const failing = () => new ReadableStream({
      pull(controller) { controller.error(new Error("socket reset")); },
    });
    const discards = [];
    const onExhausted = vi.fn();
    const reexecute = vi.fn(async () => failing());
    const guarded = createEmptyRetryStream({
      body: failing(),
      reexecute,
      onAttemptDiscarded: (_body, reason) => discards.push(reason),
      onExhausted,
      stallTimeoutMs: 50,
      baseDelayMs: 1,
    });
    const reader = guarded.getReader();
    let wire = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      wire += decoder.decode(value, { stream: true });
    }

    expect(reexecute).toHaveBeenCalledTimes(2);
    expect(discards).toEqual(["read_error", "read_error", "read_error"]);
    expect(onExhausted.mock.calls[0][0]).toContain("read_error");
    expect(wire).toContain("read_error");
    expect(wire).not.toContain("stream stall timeout");
  });
});
