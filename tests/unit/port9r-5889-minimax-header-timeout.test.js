import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const credentials = {
  accessToken: "mmc_synthetic_token",
  providerSpecificData: { enableSessionDispatch: true, region: "en" },
};

function okResponse() {
  return new Response(JSON.stringify({
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: "MiniMax-M3",
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 2, output_tokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("MiniMax Code response header timeout (upstream #5889)", () => {
  it("waits past FETCH_CONNECT_TIMEOUT_MS up to MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS", async () => {
    vi.stubEnv("FETCH_CONNECT_TIMEOUT_MS", "60000");
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "");
    vi.stubEnv("MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS", "180000");
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "0");
    vi.resetModules();
    vi.useFakeTimers();

    const { MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js");
    const executor = new MinimaxCodeExecutor({ retryBaseMs: 1 });
    const request = {
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    };

    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(okResponse()), 90_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    }));
    const delayed = executor.execute(request);
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(delayed).resolves.toHaveProperty("response.status", 200);

    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const timedOut = executor.execute(request);
    await vi.advanceTimersByTimeAsync(180_000);
    const result = await timedOut;
    expect(result.response.status).toBe(500);
    expect((await result.response.json()).error.message).toContain("180000 ms");
  });

  it("names upstream response headers and elapsed ms when BaseExecutor header deadline fires", async () => {
    vi.stubEnv("FETCH_CONNECT_TIMEOUT_MS", "60000");
    vi.stubEnv("MINIMAX_CODE_GATEWAY_TIMEOUT_MS", "240000");
    vi.stubEnv("MINIMAX_CODE_RESPONSE_HEADERS_TIMEOUT_MS", "120000");
    vi.stubEnv("MINIMAX_CODE_GATEWAY_RETRIES", "0");
    vi.resetModules();
    vi.useFakeTimers();

    const { MinimaxCodeExecutor } = await import("../../open-sse/executors/minimax-code.js");
    const executor = new MinimaxCodeExecutor({ retryBaseMs: 1 });
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const pending = expect(executor.execute({
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
    })).rejects.toThrow("Upstream did not send response headers within 120000 ms");
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;
  });
});
