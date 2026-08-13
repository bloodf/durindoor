import "../translator/registerAll.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  countInputTokens: vi.fn(),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const realExecutor = new BaseExecutor("test", {});

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: vi.fn().mockResolvedValue(null),
    resolveEffectiveOutputReservation: (body, context) => realExecutor.resolveEffectiveOutputReservation(body, context),
  })),
}));

vi.mock("../../open-sse/handlers/countTokensCore.js", () => ({
  estimateTokens: vi.fn(),
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

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));
vi.mock("../../open-sse/translator/concerns/modality.js", () => ({ stripUnsupportedModalities: vi.fn(() => false) }));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({ prefetchRemoteImages: vi.fn(async () => 0) }));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })),
  saveUsageStats: vi.fn(),
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error?.message || String(error)),
  parseUpstreamError: vi.fn(async () => ({ statusCode: 502, message: "upstream", resetsAtMs: undefined })),
  sanitizeErrorMessage: vi.fn((message) => message),
}));
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const {
  clearLiveModelLimitsCache,
  resolveLiveOpenAIModels,
  warmLiveModelLimits,
} = await import("../../open-sse/services/liveModelLimits.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const PROVIDER = "test";
const MODEL = "gpt-5-test";
const STATIC_WINDOW = 400_000;
const OUTPUT_CAP = 1_000;
const connection = {
  apiKey: "live-limit-test-key",
  connectionId: "live-limit-connection",
  providerSpecificData: { baseUrl: "https://catalog.test/v1" },
};

function options(modelCapabilities = { maxOutput: OUTPUT_CAP }) {
  const body = {
    model: `${PROVIDER}/${MODEL}`,
    stream: false,
    messages: [{ role: "user", content: "not a bypass command" }],
  };
  return {
    body,
    modelInfo: { provider: PROVIDER, model: MODEL },
    credentials: { ...connection },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    modelCapabilities,
  };
}

async function cacheLiveWindow(contextWindow) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    data: [{ id: MODEL, context_window: contextWindow, max_output_tokens: OUTPUT_CAP }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
  await resolveLiveOpenAIModels(connection, {
    provider: PROVIDER,
    endpoint: "https://catalog.test/v1/models",
    guard: "none",
  });
}

describe("live model limits in request preflight", () => {
  beforeEach(() => {
    clearLiveModelLimitsCache();
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearLiveModelLimitsCache();
  });

  it("permits input above the static window when the live window is larger", async () => {
    await cacheLiveWindow(600_000);
    mocks.countInputTokens.mockResolvedValue({ tokens: 450_000, approximate: true });

    const result = await handleChatCore(options());

    expect(result?.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects input below the static window when the live window is smaller", async () => {
    await cacheLiveWindow(100_000);
    mocks.countInputTokens.mockResolvedValue({ tokens: 150_000, approximate: true });

    const result = await handleChatCore(options());

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toContain("exceeds the 100000-token context length");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses live max output instead of inherited static reservation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: MODEL, context_window: 100_000, max_output_tokens: 10_000 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await resolveLiveOpenAIModels(connection, {
      provider: PROVIDER,
      endpoint: "https://catalog.test/v1/models",
      guard: "none",
    });
    mocks.countInputTokens.mockResolvedValue({ tokens: 95_000, approximate: true });

    const inheritedCaps = { contextWindow: STATIC_WINDOW, maxOutput: OUTPUT_CAP };
    Object.defineProperty(inheritedCaps, "customKeys", { value: new Set(), enumerable: false });
    const result = await handleChatCore(options(inheritedCaps));

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toContain("95000 input + 10000 output reservation");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("uses the unchanged static path when the live cache is cold", async () => {
    mocks.countInputTokens.mockResolvedValue({ tokens: STATIC_WINDOW - OUTPUT_CAP + 1, approximate: true });

    const result = await handleChatCore(options());

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toContain(`exceeds the ${STATIC_WINDOW}-token context length`);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps preflight fail-soft while a background resolver throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("catalog offline"); }));
    expect(() => warmLiveModelLimits(PROVIDER, connection, {
      endpoint: "https://catalog.test/v1/models",
      guard: "none",
    })).not.toThrow();
    mocks.countInputTokens.mockResolvedValue({ tokens: STATIC_WINDOW - OUTPUT_CAP + 1, approximate: true });

    const result = await handleChatCore(options());

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toContain(`exceeds the ${STATIC_WINDOW}-token context length`);
  });

  it("keeps an explicit custom window ahead of the live value", async () => {
    await cacheLiveWindow(100_000);
    mocks.countInputTokens.mockResolvedValue({ tokens: 200_000, approximate: true });

    const result = await handleChatCore(options({ contextWindow: 500_000, maxOutput: OUTPUT_CAP }));

    expect(result?.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
