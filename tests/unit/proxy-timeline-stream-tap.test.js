import { describe, expect, it, vi } from "vitest";
import { createDisconnectAwareStream, pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { attachClientFrameTap } from "../../open-sse/handlers/chatCore/proxyTimeline.js";
import * as timeline from "@/lib/db/repos/proxyTimelineRepo.js";

async function drain(readable) {
  const reader = readable.getReader();
  const output = [];
  for (;;) {
    const item = await reader.read().catch((error) => ({ error }));
    if (item.error) return { output, error: item.error };
    if (item.done) break;
    output.push(item.value);
  }
  return { output, error: null };
}

describe("attachClientFrameTap", () => {
  it("frames raw bytes into sse_chunk timeline events and flushes trailing data on end", () => {
    const recorded = [];
    const spy = vi.spyOn(timeline, "record").mockImplementation((traceId, event) => recorded.push({ traceId, ...event }));
    const tap = attachClientFrameTap("trace-1", "sse-lines");
    tap.onClientBytes(Buffer.from("data: one\n"));
    tap.onClientBytes(Buffer.from("data: two\n"));
    tap.onClientBytes(Buffer.from("data: leftover"));
    tap.onClientEnd();
    expect(recorded.map((e) => e.payload)).toEqual(["data: one", "data: two", "data: leftover"]);
    expect(recorded.every((e) => e.type === "sse_chunk" && e.direction === "out")).toBe(true);
    spy.mockRestore();
  });

  it("flushes a trailing partial record on abort too", () => {
    const recorded = [];
    const spy = vi.spyOn(timeline, "record").mockImplementation((traceId, event) => recorded.push(event));
    const tap = attachClientFrameTap("trace-2", "ndjson");
    tap.onClientBytes(Buffer.from('{"a":1}\n{"a":2'));
    tap.onClientAbort();
    expect(recorded.map((e) => e.payload)).toEqual(['{"a":1}', '{"a":2']);
    spy.mockRestore();
  });

  it("fails open when record throws", () => {
    const spy = vi.spyOn(timeline, "record").mockImplementation(() => { throw new Error("boom"); });
    const tap = attachClientFrameTap("trace-3", "ndjson");
    expect(() => tap.onClientBytes(Buffer.from('{"a":1}\n'))).not.toThrow();
    expect(() => tap.onClientEnd()).not.toThrow();
    expect(() => tap.onClientAbort()).not.toThrow();
    spy.mockRestore();
  });
});

describe("createDisconnectAwareStream client tap", () => {
  it("forwards onClientBytes on every enqueue and preserves the original readable", async () => {
    const seen = [];
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
    const onClientEnd = vi.fn();
    const onClientAbort = vi.fn();
    const readable = createDisconnectAwareStream(
      { readable: transform.readable, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } }, controller, null, null,
      (bytes) => seen.push(Buffer.from(bytes).toString()),
      onClientEnd, onClientAbort,
    );
    const readerPromise = drain(readable);
    await writer.write(Buffer.from("data: one\n"));
    await writer.write(Buffer.from("data: two"));
    await writer.close();
    const { output } = await readerPromise;
    expect(output.map((v) => Buffer.from(v).toString())).toEqual(["data: one\n", "data: two"]);
    expect(seen).toEqual(["data: one\n", "data: two"]);
    expect(onClientEnd).toHaveBeenCalledTimes(1);
    expect(onClientAbort).not.toHaveBeenCalled();
  });

  it("calls onClientAbort (not onClientEnd) after a controller error, and does not break the readable", async () => {
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
    const onClientEnd = vi.fn();
    const onClientAbort = vi.fn();
    const onClientBytes = vi.fn(() => { throw new Error("tap failure must not break stream"); });
    const readable = createDisconnectAwareStream(
      { readable: transform.readable, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } }, controller, null, null,
      onClientBytes, onClientEnd, onClientAbort,
    );
    const readerPromise = drain(readable);
    await writer.write(Buffer.from("data: one\n"));
    await writer.abort(new Error("socket hang up"));
    const { output, error } = await readerPromise;
    expect(output.map((v) => Buffer.from(v).toString())).toEqual(["data: one\n"]);
    expect(error).toBeFalsy();
    expect(onClientAbort).toHaveBeenCalledTimes(1);
    expect(onClientEnd).not.toHaveBeenCalled();
  });

  it("calls onClientAbort when premature EOF requires a recovery terminal", async () => {
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn() };
    const terminalTracker = {
      observeClientFrame: vi.fn(),
      buildRecoveryBytes: vi.fn(() => Buffer.from("data: recovery\n\n")),
    };
    const onClientEnd = vi.fn();
    const onClientAbort = vi.fn();
    const readable = createDisconnectAwareStream(
      { readable: transform.readable }, controller, null, terminalTracker,
      null, onClientEnd, onClientAbort,
    );
    const readerPromise = drain(readable);
    await writer.close();
    const { error } = await readerPromise;
    expect(error).toBeFalsy();
    expect(controller.handleError).toHaveBeenCalledWith(expect.objectContaining({
      message: "upstream stream ended before client terminal",
    }));
    expect(onClientAbort).toHaveBeenCalledTimes(1);
    expect(onClientEnd).not.toHaveBeenCalled();
  });

  it("calls onClientAbort on cancel", () => {
    const transform = new TransformStream();
    const controller = { isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn(), handleDisconnect: vi.fn() };
    const onClientAbort = vi.fn();
    const readable = createDisconnectAwareStream(transform, controller, null, null, null, null, onClientAbort);
    readable.cancel("client disconnected");
    expect(onClientAbort).toHaveBeenCalledTimes(1);
  });
});

describe("pipeWithDisconnect client tap", () => {
  it("taps framed bytes through a real unlocked TransformStream", async () => {
    const seen = [];
    const onClientEnd = vi.fn();
    const onClientAbort = vi.fn();
    const transform = new TransformStream({
      transform(chunk, controller) { controller.enqueue(chunk); },
    });
    const providerResponse = {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from("data: one\n"));
          controller.enqueue(Buffer.from("data: two\n"));
          controller.close();
        },
      }),
    };
    const streamController = {
      isConnected: () => true,
      handleComplete: vi.fn(),
      handleError: vi.fn(),
      handleDisconnect: vi.fn(),
      handleActivity: vi.fn(),
      abort: vi.fn(),
      signal: undefined,
      startTime: Date.now(),
    };
    const readable = pipeWithDisconnect(
      providerResponse,
      transform,
      streamController,
      null,
      60_000,
      null,
      (bytes) => seen.push(Buffer.from(bytes).toString()),
      onClientEnd,
      onClientAbort,
    );
    const { output, error } = await drain(readable);
    expect(error).toBeFalsy();
    expect(output.map((v) => Buffer.from(v).toString())).toEqual(["data: one\n", "data: two\n"]);
    expect(seen).toEqual(["data: one\n", "data: two\n"]);
    expect(onClientEnd).toHaveBeenCalledTimes(1);
    expect(onClientAbort).not.toHaveBeenCalled();
  });
});
