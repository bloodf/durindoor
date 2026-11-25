// A non-OK redispatch of an empty Antigravity stream records the status the
// dispatched credential was rejected with.
import "../translator/registerAll.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  parseRetryFromErrorMessage: vi.fn(),
  handleStreamingResponse: vi.fn(),
  parseUpstreamError: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true })),
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

vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCapabilitiesForModel: vi.fn(() => ({})),
  // Unknown limits: the preflight must stay out of the way of these tests.
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
  hasMediaBlocks: vi.fn(() => false),
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
  formatProviderError: vi.fn((error, _provider, _model, status) => `[${status}]: ${error.message}`),
  parseUpstreamError: mocks.parseUpstreamError,
  errorResponse: vi.fn(),
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

vi.mock("../../src/sse/services/auth.js", () => ({
  projectProviderCredentials: vi.fn(),
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})), updateProviderConnection: vi.fn() }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: vi.fn() }));
vi.mock("../../src/sse/handlers/chat/singleModel/providerHooks.js", () => ({ onProviderRequestSuccess: vi.fn() }));
vi.mock("@/lib/routing/connectionRecovery.js", () => ({
  runWithConnectionRecovery: vi.fn((core, options) => core(options)),
}));

const emptySse = () => 'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n';
const providerResult = (response) => ({ response, url: "https://antigravity.test/stream", headers: {}, transformedBody: null });
const emptyAttempt = () => providerResult(new Response(emptySse(), { status: 200 }));

async function drainWithRejectedRetry(status, onUpstreamEmptyExhausted) {
  const body = { model: "agy/gemini-2.5-pro", stream: true, messages: [{ role: "user", content: "hi" }] };
  mocks.execute
    .mockResolvedValueOnce(emptyAttempt())
    .mockResolvedValueOnce(providerResult(new Response("rejected", { status })));
  mocks.parseUpstreamError.mockResolvedValue({ statusCode: status, message: "rejected by upstream" });
  const result = await handleChatCore({
    body,
    modelInfo: { provider: "agy", model: "gemini-2.5-pro" },
    credentials: { accessToken: "tok", connectionId: "agy-conn", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "text/event-stream" } },
    connectionId: "agy-conn",
    onUpstreamEmptyExhausted,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const text = result.response.text();
  await vi.runAllTimersAsync();
  return text;
}

describe("OmniRoute #20993 — redispatched stream credential outcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockReset();
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it.each([401, 429])("reports a %i retry once and keeps the in-stream error", async (status) => {
    const onExhausted = vi.fn();

    const text = await drainWithRejectedRetry(status, onExhausted);

    expect(onExhausted).toHaveBeenCalledExactlyOnceWith(
      `[${status}]: [${status}] rejected by upstream`, undefined, status);
    expect(text).toContain(`[${status}] rejected by upstream`);
    expect(text).toContain('"code":502');
  });

  it("keeps a server error retry as an empty-response 502", async () => {
    const onExhausted = vi.fn();

    await drainWithRejectedRetry(500, onExhausted);

    expect(onExhausted).toHaveBeenCalledExactlyOnceWith("[502]: [500] rejected by upstream", undefined, 502);
  });

  it.each([[429, 429], [undefined, 502]])("records status %s against the dispatched credential as %i", async (status, recorded) => {
    const { dispatchAttempt } = await import("../../src/sse/handlers/chat/singleModel/dispatch.js");
    const core = await import("../../open-sse/handlers/chatCore.js");
    const spy = vi.fn(async (options) => {
      await options.onUpstreamEmptyExhausted("retry rejected", undefined, status);
      return { success: false };
    });
    const { runWithConnectionRecovery } = await import("@/lib/routing/connectionRecovery.js");
    runWithConnectionRecovery.mockImplementationOnce((handler, options) => {
      expect(handler).toBe(core.handleChatCore);
      return spy(options);
    });
    const ctx = { provider: "agy", model: "gemini-2.5-pro", body: {}, request: null, requestSignal: null };
    const attempt = {
      credentials: { connectionId: "agy-conn" },
      refreshedCredentials: { connectionId: "agy-conn" },
      dispatchedCredential: "fingerprint-1",
      latestAttemptStartedAt: 1000,
    };

    await dispatchAttempt(ctx, { excludeConnectionIds: new Set() }, attempt);

    expect(mocks.markAccountUnavailable).toHaveBeenCalledExactlyOnceWith(
      "agy-conn", recorded, "retry rejected", "agy", "gemini-2.5-pro", undefined,
      expect.objectContaining({ credentialFingerprint: "fingerprint-1" }));
  });
});
