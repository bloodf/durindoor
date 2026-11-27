import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), detail: vi.fn(async () => {}) }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  maskSensitiveUrl: (url) => url,
  createRequestLogger: async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: mocks.detail, saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const secret = "synthetic-private-upstream-message";
const enc = new TextEncoder();
function trailer(text) {
  const payload = enc.encode(text);
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = 0x80;
  new DataView(frame.buffer).setUint32(1, payload.length);
  frame.set(payload, 5);
  return frame;
}

describe("Windsurf gateway error boundary", () => {
  it.each([false, true])("does not disclose HTTP and gRPC error text with stream=%s", async (stream) => {
    for (const [upstream, status] of [[new Response(JSON.stringify({ error: { message: secret } }), { status: 403 }), 403], [new Response(trailer(`grpc-status: 7\r\ngrpc-message: ${secret}\r\n`)), 502], [new Response(secret.repeat(10000), { status: 500 }), 500], [new Response(new Uint8Array([0, 0, 0, 1, 0, 1])), 502]]) {
      mocks.fetch.mockClear();
      mocks.fetch.mockResolvedValueOnce(upstream);
      mocks.detail.mockClear();
      const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() };
      const body = { model: "swe-1", stream, messages: [{ role: "user", content: "hello" }] };
      const result = await handleChatCore({ body, modelInfo: { provider: "windsurf", model: "swe-1" }, credentials: { accessToken: "fixture-token" }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, log });
      expect(result.response.status).toBe(status);
      expect(await result.response.text()).not.toContain(secret);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.errorLine.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(mocks.detail.mock.calls)).not.toContain(secret);
    }
  });
});


describe("Windsurf error evidence and dispatch", () => {
  it("retains rate-limit evidence without returning the raw HTTP body", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const { parseUpstreamError } = await import("../../open-sse/utils/error.js");
    const parsed = await parseUpstreamError(new Response(secret, { status: 429, headers: { "retry-after": "30" } }), new WindsurfExecutor());
    expect(parsed.statusCode).toBe(429);
    expect(parsed.rateLimitEvidence.resetAtMs).toBeGreaterThan(Date.now());
    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  it("does not dispatch an already cancelled request", async () => {
    const { WindsurfExecutor } = await import("../../open-sse/executors/windsurf.js");
    const controller = new AbortController();
    controller.abort();
    mocks.fetch.mockClear();
    await expect(new WindsurfExecutor().execute({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
