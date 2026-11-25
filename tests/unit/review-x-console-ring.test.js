import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

describe("console capture ring", () => {
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
  });

  it("formats mixed entries in order and delivers stream batches", async () => {
    const buffer = await import("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();
    const listener = vi.fn();
    buffer.getConsoleEmitter().on("lines", listener);
    console.log("\u001b[31mred\u001b[0m", { value: 2 });
    console.warn([1, 2], false);
    const expected = ['red {"value":2}', "[1,2] false"];
    expect(buffer.getConsoleLogs()).toEqual(expected);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(expected));
    buffer.clearConsoleLogs();
    expect(buffer.getConsoleLogSnapshot()).toEqual({ logs: [], revision: 3 });
  });

  it("defers serialization and bounds retained entries after 100k calls", async () => {
    const buffer = await import("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();
    const toJSON = vi.fn(() => ({ payload: "x".repeat(10000) }));
    for (let index = 0; index < 100000; index += 1) console.log(index);
    console.log({ toJSON });
    expect(toJSON).not.toHaveBeenCalled();
    expect(global._consoleLogBufferState.logs).toHaveLength(CONSOLE_LOG_CONFIG.maxLines);
    expect(global._consoleLogBufferState.pendingLines).toHaveLength(0);
    const logs = buffer.getConsoleLogs();
    expect(logs).toHaveLength(CONSOLE_LOG_CONFIG.maxLines);
    expect(logs[0]).toBe("98001");
    expect(logs.at(-1)).toBe(JSON.stringify({ payload: "x".repeat(10000) }));
    expect(toJSON).toHaveBeenCalledOnce();
  });
});
