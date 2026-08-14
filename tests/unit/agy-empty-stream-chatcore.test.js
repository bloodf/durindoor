// Antigravity/AGY empty-stream guard wiring in chatCore (port of decolua/9router#2462).
// Drives the REAL guard by mocking handleStreamingResponse to return the wrapped
// providerResponse, then draining it — proving (a) the `agy` alias is gated into
// the same retry path as `antigravity`, and (b) quota reset times parsed from
// the held upstream error reach onUpstreamEmptyExhausted as an absolute ms.
import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  parseRetryFromErrorMessage: vi.fn(),
  handleStreamingResponse: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: vi.fn().mockResolvedValue(null),
    parseRetryFromErrorMessage: mocks.parseRetryFromErrorMessage,
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

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
  // Unknown limits: the preflight must stay out of the way of these tests.
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((d) => d),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })),
  saveUsageStats: vi.fn(),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error?.message || String(error)),
  parseUpstreamError: vi.fn(async () => ({ statusCode: 429, message: "quota", resetsAtMs: undefined })),
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: mocks.handleStreamingResponse,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

// One empty Gemini attempt: a 200 SSE stream carrying only an embedded quota
// error object (no candidates) — the guard classifies it as hold/error_object
// and retries; after MAX_RETRIES it exhausts and hands the error to onExhausted.
const quotaSse = () =>
  "data: " + JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded. Your quota will reset after 1h2m3s" },
  }) + "\n\n";

function providerResult() {
  return {
    response: new Response(quotaSse(), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    url: "https://antigravity.test/v1internal:streamGenerateContent",
    headers: {},
    transformedBody: null,
  };
}

function makeAgyOptions(onUpstreamEmptyExhausted) {
  const body = {
    model: "agy/gemini-2.5-pro",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  };
  return {
    body,
    modelInfo: { provider: "agy", model: "gemini-2.5-pro" },
    credentials: { accessToken: "tok", refreshToken: "ref", connectionId: "agy-conn", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "text/event-stream" } },
    connectionId: "agy-conn",
    onUpstreamEmptyExhausted,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("AGY empty-stream guard wiring in chatCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Return the (guard-wrapped) providerResponse so the caller can drain it.
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
  });

  it("agy alias retries empty streams and benches with absolute quota reset ms", async () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    try {
      mocks.parseRetryFromErrorMessage.mockReturnValue(3_723_000); // 1h2m3s
      // Initial attempt + EMPTY_STREAM_MAX_RETRIES(2) reexecutes = 3 executes.
      mocks.execute
        .mockResolvedValueOnce(providerResult())
        .mockResolvedValueOnce(providerResult())
        .mockResolvedValueOnce(providerResult());
      const onExhausted = vi.fn((_reason, resetsAtMs) => {
        // chatCore computes Date.now() at exhaustion time (after the 500+1000ms
        // backoff), so pin the relationship rather than an absolute timestamp.
        expect(resetsAtMs - Date.now()).toBe(3_723_000);
      });

      const result = await handleChatCore(makeAgyOptions(onExhausted));
      // Drain the wrapped stream to run the guard to exhaustion. Advance timers
      // so the 500ms/1000ms retry backoff resolves without a real wait.
      const textPromise = result.response.text();
      await vi.runAllTimersAsync();
      await textPromise;

      expect(mocks.execute).toHaveBeenCalledTimes(3);
      // Every retry re-dispatches the provider-facing upstream model id and the
      // captured request context (alias must not change the upstream model).
      for (const call of mocks.execute.mock.calls) {
        expect(call[0].model).toBe("gemini-2.5-pro");
        expect(call[0].requestContext).toBeDefined();
      }
      expect(onExhausted).toHaveBeenCalledTimes(1);
      expect(mocks.parseRetryFromErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("reset after 1h2m3s"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-auth requests complete without attaching runtime transport", async () => {
    mocks.execute.mockResolvedValue(providerResult());
    const options = makeAgyOptions(vi.fn());
    options.credentials = null;

    const result = await handleChatCore(options);

    expect(result.success).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ credentials: null }));
  });
});
