import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

it("writes stream counters only when flushed", async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a2302-"));
  try {
    process.chdir(dir);
    process.env.ENABLE_REQUEST_LOGS = "true";
    vi.resetModules();
    const writes = vi.spyOn(fs, "writeFileSync");
    syncBuiltinESMExports();
    const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js");
    const logger = await createRequestLogger("openai", "openai", "test");
    for (let i = 0; i < 1000; i++) logger.appendProviderChunk("é");
    expect(writes).toHaveBeenCalledTimes(0);
    logger.flushStreams();
    expect(writes).toHaveBeenCalledTimes(1);
    const result = JSON.parse(fs.readFileSync(path.join(logger.sessionPath, "5_res_provider.txt"), "utf8"));
    expect(result.body).toEqual({ redacted: true, present: true, type: "string", bytes: 2000 });
    expect(result.chunks).toBe(1000);
  } finally {
    process.chdir(cwd);
    delete process.env.ENABLE_REQUEST_LOGS;
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(() => vi.resetModules());

it("retains the latest entries and formats primitive values on read", async () => {
  const levels = ["log", "info", "warn", "error", "debug"];
  const originals = Object.fromEntries(levels.map((level) => [level, console[level]]));
  delete global._consoleLogBufferState;
  try {
    for (const level of levels) console[level] = () => {};
    const buffer = await import("@/lib/consoleLogBuffer");
    buffer.initConsoleLogCapture();
    for (let i = 0; i < CONSOLE_LOG_CONFIG.maxLines + 2; i++) console.log(i);
    expect(global._consoleLogBufferState.logs[0]).toEqual([CONSOLE_LOG_CONFIG.maxLines]);
    const logs = buffer.getConsoleLogs();
    expect(logs).toHaveLength(CONSOLE_LOG_CONFIG.maxLines);
    expect(logs[0]).toBe("2");
    expect(logs.at(-1)).toBe(String(CONSOLE_LOG_CONFIG.maxLines + 1));
  } finally {
    for (const level of levels) console[level] = originals[level];
    delete global._consoleLogBufferState;
  }
});
