import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const cwd = process.cwd();
let temp;
afterEach(() => {
  process.chdir(cwd);
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  delete process.env.ENABLE_REQUEST_LOGS;
  vi.resetModules();
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

it("buffers 1,000 chunks and persists the same metadata at finalization", async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "request-counters-"));
  process.chdir(temp);
  process.env.ENABLE_REQUEST_LOGS = "true";
  vi.resetModules();
  const writes = vi.spyOn(fs, "writeFileSync");
  syncBuiltinESMExports();
  const { createRequestLogger } = await import("../../open-sse/utils/requestLogger.js");
  const logger = await createRequestLogger("openai", "claude", "model");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  try {
    for (let i = 0; i < 1000; i++) {
      logger.appendProviderChunk("é");
      logger.appendOpenAIChunk(new Uint8Array([1, 2, 3]));
      logger.appendConvertedChunk("ok");
    }
    expect(writes).toHaveBeenCalledTimes(0);
    logger.flushStreams();
    logger.flushStreams();
    expect(writes).toHaveBeenCalledTimes(3);
    for (const [name, type, bytes] of [["5_res_provider.txt", "string", 2000], ["6_res_openai.txt", "bytes", 3000], ["7_res_client.txt", "string", 2000]]) {
      expect(JSON.parse(fs.readFileSync(path.join(logger.sessionPath, name), "utf8"))).toEqual({
        timestamp: "2026-01-01T00:00:00.000Z",
        body: { redacted: true, present: true, type, bytes },
        chunks: 1000,
      });
    }
    logger.appendProviderChunk("x");
    logger.logError(new Error("failure"));
    expect(JSON.parse(fs.readFileSync(path.join(logger.sessionPath, "5_res_provider.txt"), "utf8")).body.bytes).toBe(2001);
    expect(writes).toHaveBeenCalledTimes(5);
  } finally {
    vi.useRealTimers();
  }
});

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn().mockResolvedValue(undefined),
  saveRequestUsage: vi.fn().mockResolvedValue(undefined),
  appendRequestLog: vi.fn().mockResolvedValue(undefined),
}));

it.each(["end", "abort", "error"])("flushes counters on stream %s", async (ending) => {
  const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
  const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");
  let upstream;
  const body = new ReadableStream({
    start(controller) {
      upstream = controller;
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
      if (ending === "end") controller.close();
    },
  });
  const logger = { appendProviderChunk: vi.fn(), appendConvertedChunk: vi.fn(), flushStreams: vi.fn() };
  const result = await handleStreamingResponse({
    providerResponse: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    provider: "test-provider", model: "model", sourceFormat: "openai", targetFormat: "openai",
    body: {}, stream: true, requestStartTime: Date.now(), reqLogger: logger,
    streamController: createStreamController({ provider: "test-provider", model: "model" }),
  });
  const reader = result.response.body.getReader();
  await reader.read();
  if (ending === "abort") await reader.cancel();
  else {
    if (ending === "error") upstream.error(new Error("network failure"));
    try { while (!(await reader.read()).done) {} } catch { /* expected upstream failure */ }
  }
  expect(logger.appendProviderChunk).toHaveBeenCalled();
  expect(logger.flushStreams).toHaveBeenCalledTimes(1);
});
