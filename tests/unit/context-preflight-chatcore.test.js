// Ingress context-limit preflight (C1/C2) in chatCore.
//
// Before this guard, an oversize request was translated, compressed, and shipped
// upstream purely to come back as a 400. The preflight rejects it locally using
// the SAME output reservation the executor would clamp to, and stays silent when
// the model's real window is unknown.
import "../translator/registerAll.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveModelLimits: vi.fn(),
  estimateTokens: vi.fn(),
  countInputTokens: vi.fn(),
  proxyAwareFetch: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  startTrace: vi.fn(() => "trace-preflight"),
  record: vi.fn(),
  finishTrace: vi.fn(),
}));

// Real BaseExecutor reservation logic — the point of the test is that the
// preflight and the clamp agree, so this must NOT be stubbed.
const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const realExecutor = new BaseExecutor("test", {});

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: vi.fn().mockResolvedValue(null),
    resolveEffectiveOutputReservation: (body, ctx) => realExecutor.resolveEffectiveOutputReservation(body, ctx),
  })),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({ maxOutput: 1000 })),
  resolveModelLimits: mocks.resolveModelLimits,
}));

vi.mock("../../open-sse/handlers/countTokensCore.js", () => ({
  estimateTokens: mocks.estimateTokens,
  countInputTokens: mocks.countInputTokens,
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
  parseUpstreamError: vi.fn(async () => ({ statusCode: 502, message: "upstream", resetsAtMs: undefined })),
  sanitizeErrorMessage: vi.fn((m) => m),
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: vi.fn(async () => ({ success: true })),
}));

vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: mocks.startTrace,
  record: mocks.record,
  finishTrace: mocks.finishTrace,
  attachClientFrameTap: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: mocks.appendRequestLog,
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { isDeterministicPayloadError } = await import("../../open-sse/services/modelFallback.js");

const CONTEXT_WINDOW = 200_000;
const OUTPUT_CAP = 1_000;

function makeOptions(overrides = {}) {
  const body = {
    model: "test/model-x",
    stream: false,
    messages: [{ role: "user", content: "hi" }],
    ...overrides.body,
  };
  return {
    body,
    modelInfo: { provider: "test", model: "model-x" },
    credentials: { accessToken: "tok", connectionId: "c1", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    modelCapabilities: { maxOutput: OUTPUT_CAP },
    ...overrides.options,
  };
}

describe("chatCore ingress context-limit preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://test.local/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
    mocks.resolveModelLimits.mockReturnValue({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: OUTPUT_CAP,
      known: true,
      source: "provider",
    });
  });

  // Three-point boundary: limit-1 and limit pass, limit+1 rejects.
  it("accepts a request one token below the context window", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW - OUTPUT_CAP - 1, approximate: true });

    const result = await handleChatCore(makeOptions());

    expect(result?.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalled();
  });

  it("accepts a request that lands exactly on the context window", async () => {
    // input + the OUTPUT_CAP reservation sums to exactly contextWindow.
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW - OUTPUT_CAP, approximate: true });

    const result = await handleChatCore(makeOptions());

    expect(result?.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalled();
  });

  it("rejects a request one token over the context window without dispatching", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW - OUTPUT_CAP + 1, approximate: true });

    const result = await handleChatCore(makeOptions());

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(/input is too long/i);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.startTrace).toHaveBeenCalled();
    expect(mocks.finishTrace).toHaveBeenCalledWith("trace-preflight", { status: "error" });
  });

  // A locally-rejected oversize payload must not trigger the fallback chain:
  // no other model would accept it either.
  it("phrases the rejection so the fallback chain treats it as terminal", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW * 2, approximate: true });

    const result = await handleChatCore(makeOptions());

    expect(isDeterministicPayloadError(result.status, result.error)).toBe(true);
  });

  // The quota ticket is reserved before translation. A local rejection returns
  // before every dispatch settlement path, so without an explicit settle the
  // reservation holds provider capacity until its lease expires.
  it("releases the quota reservation when it rejects", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW * 2, approximate: true });
    const settle = vi.fn(async () => ({ changed: true }));

    const result = await handleChatCore(makeOptions({
      options: { quotaReservation: { tracked: true, settle, heartbeat: vi.fn() } },
    }));

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith({ success: false, reason: "context_limit" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  // Callers may not pass modelCapabilities at all. The reservation must then
  // come from the resolved catalog cap, not silently collapse to zero — which
  // would compare raw input against the window and let oversize requests through.
  it("reserves the catalog cap when the caller supplies no modelCapabilities", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW - OUTPUT_CAP + 1, approximate: true });

    const result = await handleChatCore(makeOptions({ options: { modelCapabilities: undefined } }));

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toMatch(new RegExp(`\\+ ${OUTPUT_CAP} output reservation`));
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  // Never block on a guessed limit: the bare capability floor is not evidence.
  it("does not reject when the model's real limit is unknown", async () => {
    mocks.resolveModelLimits.mockReturnValue({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: OUTPUT_CAP,
      known: false,
      source: "default",
    });
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW * 100, approximate: true });

    const result = await handleChatCore(makeOptions());

    expect(result?.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalled();
  });

  // The client's explicit output request is capped by the clamp, so the
  // preflight must charge the clamped value, not the raw one — otherwise a
  // request the provider would accept gets rejected locally.
  it("reserves the clamped output value, not the client's oversized request", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: CONTEXT_WINDOW - OUTPUT_CAP, approximate: true });

    const result = await handleChatCore(makeOptions({ body: { max_tokens: 500_000 } }));

    expect(result?.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalled();
  });
});
