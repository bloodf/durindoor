import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const writes = vi.hoisted(() => vi.fn());
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, writeFileSync: (...args) => { writes(...args); return original.writeFileSync(...args); } };
});

const cwd = process.cwd();
const originalLogging = process.env.ENABLE_REQUEST_LOGS;
const levels = ["log", "info", "warn", "error", "debug"];
const originals = Object.fromEntries(levels.map((level) => [level, console[level]]));

afterEach(() => {
  process.chdir(cwd);
  if (originalLogging === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalLogging;
  clearTimeout(global._consoleLogBufferState?.flushTimer);
  delete global._consoleLogBufferState;
  for (const level of levels) console[level] = originals[level];
  vi.resetModules();
});

describe("stream metadata and console capture", () => {
  it("writes stream metadata only at flush or error with the final counts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a2302-"));
    try {
      process.chdir(dir);
      process.env.ENABLE_REQUEST_LOGS = "true";
      vi.resetModules();
      writes.mockClear();
      const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js");
      const logger = await createRequestLogger("source", "target", "model");
      for (let i = 0; i < 1000; i++) {
        logger.appendProviderChunk("é");
        logger.appendOpenAIChunk(new Uint8Array([1, 2, 3]));
        logger.appendConvertedChunk("ok");
      }
      expect(writes).not.toHaveBeenCalled();
      logger.flushStreams();
      expect(writes).toHaveBeenCalledTimes(3);
      for (const [name, type, bytes] of [["5_res_provider.txt", "string", 2000], ["6_res_openai.txt", "bytes", 3000], ["7_res_client.txt", "string", 2000]]) {
        const metadata = JSON.parse(fs.readFileSync(path.join(logger.sessionPath, name), "utf8"));
        expect(metadata).toEqual({ timestamp: expect.any(String), body: { redacted: true, present: true, type, bytes }, chunks: 1000 });
      }
      logger.flushStreams();
      expect(writes).toHaveBeenCalledTimes(3);
      logger.appendProviderChunk("x");
      logger.logError(new Error("interrupted"));
      expect(writes).toHaveBeenCalledTimes(5);
      expect(JSON.parse(fs.readFileSync(path.join(logger.sessionPath, "5_res_provider.txt"), "utf8")).body.bytes).toBe(2001);
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains the last entries in order and formats immutable values on read", async () => {
    vi.resetModules();
    delete global._consoleLogBufferState;
    for (const level of levels) console[level] = () => {};
    const buffer = await import("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();
    for (let i = 0; i < CONSOLE_LOG_CONFIG.maxLines + 2; i++) console.log(i);
    console.log("\u001b[31mred\u001b[0m", { count: 1 });
    expect(global._consoleLogBufferState.logs[(global._consoleLogBufferState.start + CONSOLE_LOG_CONFIG.maxLines - 1) % CONSOLE_LOG_CONFIG.maxLines][0]).toBe("\u001b[31mred\u001b[0m");
    const logs = buffer.getConsoleLogs();
    expect(logs).toHaveLength(CONSOLE_LOG_CONFIG.maxLines);
    expect(logs[0]).toBe("3");
    expect(logs.at(-1)).toBe('red {"count":1}');
  });
});
