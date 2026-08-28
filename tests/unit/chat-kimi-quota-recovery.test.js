import { resolveFallbackModelScope } from "../../open-sse/services/fallbackScope.js";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getUsageForProvider: vi.fn(),
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

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));

vi.mock("../../open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: mocks.execute,
    refreshCredentials: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  maskSensitiveUrl: vi.fn((url) => url),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const RESET_AT = "2030-01-01T01:00:00.000Z";

function options(provider = "kimi-coding", model = "kimi-for-coding") {
  const body = { model, stream: false, messages: [{ role: "user", content: "hi" }] };
  return {
    body,
    modelInfo: { provider, model },
    credentials: { accessToken: "token", providerSpecificData: {} },
    connectionId: "kimi-connection",
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorLine: vi.fn() },
  };
}

function quotaExhausted() {
  return {
    response: new Response(JSON.stringify({ error: { message: "Request limit reached for current billing cycle" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
    url: "https://api.kimi.com/coding/v1/chat/completions",
    headers: {},
    transformedBody: null,
  };
}

describe("Kimi temporary quota recovery in chatCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(quotaExhausted());
  });

  it("uses the exact registered model as fallback scope", () => {
    expect(resolveFallbackModelScope("kimi-coding", "kimi-for-coding")).toBe("kimi-for-coding");
  });

  it("returns the usage reset deadline for a temporary Kimi request limit", async () => {
    mocks.getUsageForProvider.mockResolvedValue({
      quotas: {
        "Rolling 5-hour": { remainingPercentage: 0, resetAt: RESET_AT },
        Weekly: { remainingPercentage: 50 },
      },
    });

    const result = await handleChatCore(options());

    expect(result).toMatchObject({ success: false, status: 403, resetsAtMs: Date.parse(RESET_AT) });
    expect(mocks.getUsageForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "kimi", accessToken: "token" }),
      expect.anything(),
    );
  });

  it("applies documented rolling-window recovery to every current Kimi Code model", async () => {
    mocks.getUsageForProvider.mockResolvedValue({
      quotas: {
        "Rolling 5-hour": { remainingPercentage: 0, resetAt: RESET_AT },
        Weekly: { remainingPercentage: 50 },
      },
    });

    const result = await handleChatCore(options("kimi-coding", "k3"));

    expect(result).toMatchObject({ success: false, status: 403, resetsAtMs: Date.parse(RESET_AT) });
    expect(mocks.getUsageForProvider).toHaveBeenCalledOnce();
  });

  it("keeps the original terminal 403 when the usage body times out", async () => {
    mocks.getUsageForProvider.mockRejectedValue(new DOMException("Request aborted", "AbortError"));

    const result = await handleChatCore(options());

    expect(result).toMatchObject({ success: false, status: 403, resetsAtMs: undefined });
  });

  it("leaves an exhausted weekly quota terminal", async () => {
    mocks.getUsageForProvider.mockResolvedValue({
      quotas: {
        "Rolling 5-hour": { remainingPercentage: 0, resetAt: RESET_AT },
        Weekly: { remainingPercentage: 0 },
      },
    });

    const result = await handleChatCore(options("kimi-coding-apikey"));

    expect(result).toMatchObject({ success: false, status: 403, resetsAtMs: undefined });
  });

  it.each([
    ["has no usable reset", { quotas: { "Rolling 5-hour": { remainingPercentage: 0, resetAt: "not-a-date" }, Weekly: { remainingPercentage: 50 } } }],
    ["cannot read usage", new Error("usage probe failed")],
  ])("leaves a request limit terminal when it %s", async (_case, usage) => {
    mocks.getUsageForProvider.mockImplementation(() => {
      if (usage instanceof Error) throw usage;
      return usage;
    });

    const result = await handleChatCore(options());

    expect(result).toMatchObject({ success: false, status: 403, resetsAtMs: undefined });
  });
});
