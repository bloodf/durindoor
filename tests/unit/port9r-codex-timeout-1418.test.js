// OmniRoute chat core request fixes, part A (#20372, #19890, #20547), offline fixtures only.
// #20372 is not applicable: DurinDoor has no plugin onRequest hook path (pinned below).
import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: vi.fn().mockResolvedValue(null),
    parseRetryFromErrorMessage: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));

vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCapabilitiesForModel: vi.fn(() => ({})),
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("@/lib/usageDb.js", async (importOriginal) => ({
  ...(await importOriginal()),
  finishActiveSession: vi.fn(),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
function executor() {
  const instance = new CodexExecutor();
  instance.buildUrl = () => "https://example.test/v1";
  instance.buildHeaders = () => ({});
  instance.transformRequest = () => ({});
  return instance;
}
const args = { model: "test", body: { input: [] }, credentials: {}, stream: true };
describe("Codex initial response deadline", () => {
  it("classifies stalled headers and respects the retry budget", async () => {
    let sends = 0;
    const directFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      sends++;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const error = await executor().execute({ ...args, directFetch, requestPolicy: { headerTimeoutMs: 5, maxTransportAttempts: 2, skipRules: [{ provider: "codex", match: { kind: "connect_timeout" }, action: "retry" }] } }).catch(e => e);
    expect(error.errorKind).toBe("connect_timeout");
    expect(sends).toBe(2);
  });
  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller left", "AbortError");
    const directFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort(reason);
    });
    const error = await executor().execute({ ...args, directFetch, signal: controller.signal }).catch(e => e);
    expect(error).toBe(reason);
    expect(error.errorKind).toBe("aborted");
  });
  it("leaves a returned stream alive after the header deadline", async () => {
    let upstreamSignal;
    const result = await executor().execute({ ...args, requestPolicy: { headerTimeoutMs: 5 }, directFetch: async (_url, { signal }) => {
      upstreamSignal = signal;
      return new Response("event: response.completed\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } });
    } });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(upstreamSignal.aborted).toBe(false);
    expect(await result.response.text()).toContain("response.completed");
  });
  it("reports a Codex connection timeout as 504 for account fallback", async () => {
    const error = Object.assign(new Error("connection timeout"), { name: "TimeoutError", errorKind: "connect_timeout" });
    mocks.execute.mockRejectedValue(error);
    const body = { model: "codex/test", stream: false, messages: [{ role: "user", content: "hi" }] };
    const result = await handleChatCore({ body, modelInfo: { provider: "codex", model: "test" }, credentials: { accessToken: "tok", providerSpecificData: {} }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: "test", log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() } });
    expect(result.status).toBe(504);
    expect(result.transportFailure).toBe("connect_timeout");
  });
});
