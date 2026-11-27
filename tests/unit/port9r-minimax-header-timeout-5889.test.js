import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GATEWAY_URL = "https://agent.minimax.io/mavis/api/v1/llm/v1/messages";
const credentials = {
  accessToken: "mmc_synthetic_header_timeout",
  providerSpecificData: { enableSessionDispatch: true, region: "en" },
};

const okResponse = () => Response.json({
  id: "msg_timeout_ok",
  type: "message",
  role: "assistant",
  model: "MiniMax-M3",
  content: [{ type: "text", text: "done" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 4, output_tokens: 2 },
});

describe("9router #5889 MiniMax Code response header timeout", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-header-timeout-5889-"));
    vi.stubEnv("DATA_DIR", path.join(root, "data"));
    vi.stubEnv("HOME", path.join(root, "home"));
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", undefined);
    vi.stubEnv("MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS", undefined);
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "0");
    fs.mkdirSync(process.env.HOME, { recursive: true });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("allows a 90s header wait under the default 100s MiniMax Code budget instead of aborting at 60s", async () => {
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => new Promise((resolve, reject) => {
      if (String(url) !== GATEWAY_URL) return reject(new Error(`unexpected URL ${url}`));
      const timer = setTimeout(() => resolve(okResponse()), 90_000);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      }, { once: true });
    })));
    const { MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js");
    const executor = new MinimaxCodeExecutor({ retryBaseMs: 1 });

    const pending = executor.execute({
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    });
    await vi.advanceTimersByTimeAsync(90_000);
    const result = await pending;
    expect(result.response.status).toBe(200);
  });

  it("honors MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS for slow headers and aborts at the configured deadline", async () => {
    vi.stubEnv("MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS", "180000");
    vi.stubGlobal("fetch", vi.fn((url, init = {}) => new Promise((resolve, reject) => {
      if (String(url) !== GATEWAY_URL) return reject(new Error(`unexpected URL ${url}`));
      const timer = setTimeout(() => resolve(okResponse()), 120_000);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      }, { once: true });
    })));
    const { MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js");
    const executor = new MinimaxCodeExecutor({ retryBaseMs: 1 });

    const slowOk = executor.execute({
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await slowOk).response.status).toBe(200);

    // Now simulate headers hanging past 180s.
    globalThis.fetch.mockImplementation((_url, init = {}) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    const hanging = executor.execute({
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    });
    await vi.advanceTimersByTimeAsync(180_000);
    const failed = await hanging;
    expect(failed.response.status).toBe(500);
    expect((await failed.response.json()).error.code).toBe("gateway_timeout");
  });
});
