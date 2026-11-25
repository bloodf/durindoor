import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("console capture snapshots", () => {
  const levels = ["log", "info", "warn", "error", "debug"];
  const saved = {};

  beforeEach(() => {
    vi.resetModules();
    delete global._consoleLogBufferState;
    for (const level of levels) {
      saved[level] = console[level];
      console[level] = () => {};
    }
  });

  afterEach(() => {
    clearTimeout(global._consoleLogBufferState?.flushTimer);
    delete global._consoleLogBufferState;
    for (const level of levels) console[level] = saved[level];
    vi.useRealTimers();
  });

  it("retains the object and array values at capture time", async () => {
    const buffer = await import("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();
    const value = { nested: { count: 1 } };
    const array = [{ count: 2 }];
    console.log(value, array);
    value.nested.count = 3;
    array[0].count = 4;
    expect(buffer.getConsoleLogs()).toEqual(['{"nested":{"count":1}} [{"count":2}]']);
  });

  it("reads and flushes circular null-prototype and unformattable objects", async () => {
    vi.useFakeTimers();
    const buffer = await import("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();
    const listener = vi.fn();
    buffer.getConsoleEmitter().on("lines", listener);
    const value = Object.create(null);
    value.self = value;
    const hostile = Object.create(null);
    Object.defineProperty(hostile, "bad", { enumerable: true, get() { throw new Error("bad"); } });
    console.log(value, hostile);
    expect(buffer.getConsoleLogs()).toEqual(['{"self":"[Circular]"} [Unformattable]']);
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(listener).toHaveBeenCalledWith(buffer.getConsoleLogs());
  });
});
