// Antigravity generation endpoint and tiered model resolution (#1398).
// Ports upstream 9router 783e271c (generation on the daily Cloud Code host,
// discovery on PROD) and 82aeb907 (client effort/budget picks the tier row),
// adapted to the fork's request-scoped suffix intent and clean wire model ids.
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

vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => ({
  ...(await importOriginal()),
  // Real capabilities stay so thinking translation is observable; unknown limits
  // keep the preflight out of the way.
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
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { default: antigravityRegistry } = await import("../../open-sse/providers/registry/antigravity.js");
const { default: agyRegistry } = await import("../../open-sse/providers/registry/agy.js");
const {
  getModelUpstreamId,
  getModelUpstreamThinkingIntent,
  resolveRequestedModelTier,
} = await import("../../open-sse/config/providerModels.js");

const DAILY = "https://daily-cloudcode-pa.googleapis.com/";
const PROD = "https://cloudcode-pa.googleapis.com/";

function okResult() {
  return {
    response: new Response(JSON.stringify({ response: { candidates: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }),
    url: "https://antigravity.test/v1internal:generateContent",
    headers: {},
    transformedBody: null,
  };
}

async function dispatch(provider, model, extra = {}) {
  mocks.execute.mockResolvedValue(okResult());
  const body = { model: `${provider}/${model}`, stream: false, messages: [{ role: "user", content: "hi" }], ...extra };
  await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: { accessToken: "tok", refreshToken: "ref", connectionId: `${provider}-conn`, providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
    connectionId: `${provider}-conn`,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const call = mocks.execute.mock.calls.at(-1)[0];
  return { model: call.model, body: call.body };
}

describe("Antigravity generation vs discovery endpoints", () => {
  it.each(["antigravity", "agy"])("%s generation uses the daily host", (provider) => {
    const executor = new AntigravityExecutor(provider);
    expect(executor.buildUrl("gemini-3.8-flash-medium", true)).toBe(`${DAILY}v1internal:streamGenerateContent?alt=sse`);
    expect(executor.buildUrl("gemini-3.8-flash-medium", false)).toBe(`${DAILY}v1internal:generateContent`);
  });

  it.each([["antigravity", antigravityRegistry], ["agy", agyRegistry]])("%s discovery stays on PROD", (_id, registry) => {
    const { usage } = registry.transport;
    for (const url of [usage.quotaApiUrl, usage.quotaSummaryApiUrl, usage.loadProjectApiUrl,
      registry.oauth.loadCodeAssistEndpoint, registry.oauth.onboardUserEndpoint]) {
      expect(url.startsWith(PROD), url).toBe(true);
    }
  });
});

describe("tiered catalog resolution", () => {
  it("resolves request tiers with suffix > body effort > budget precedence", () => {
    expect(resolveRequestedModelTier({ mode: "level", level: "low" }, { reasoning_effort: "high" })).toBe("low");
    expect(resolveRequestedModelTier({ mode: "level", level: "xhigh" })).toBe("high");
    expect(resolveRequestedModelTier({ mode: "budget", budget: 2048 })).toBe("low");
    expect(resolveRequestedModelTier({ mode: "none" }, { reasoning_effort: "high" })).toBeNull();
    expect(resolveRequestedModelTier(null, { reasoning_effort: "minimal" })).toBe("low");
    expect(resolveRequestedModelTier(null, { output_config: { effort: "max" } })).toBe("high");
    expect(resolveRequestedModelTier(null, { reasoning: { effort: "medium" } })).toBe("medium");
    expect(resolveRequestedModelTier(null, { thinking: { budget_tokens: 20000 } })).toBe("high");
    expect(resolveRequestedModelTier(null, { thinking: { budget_tokens: 8000 } })).toBe("medium");
    expect(resolveRequestedModelTier(null, {})).toBeNull();
  });

  it.each(["ag", "agy"])("%s returns clean wire ids and exposes catalog presets", (alias) => {
    expect(getModelUpstreamId(alias, "gemini-3.8-flash")).toBe("gemini-3.8-flash-medium");
    expect(getModelUpstreamId(alias, "gemini-3.8-flash", "high")).toBe("gemini-3.8-flash-high");
    expect(getModelUpstreamId(alias, "gemini-3.8-flash(low)")).toBe("gemini-3.8-flash-low");
    expect(getModelUpstreamId(alias, "gemini-3.7-flash-low")).toBe("gemini-3.7-flash-tiered");
    expect(getModelUpstreamThinkingIntent(alias, "gemini-3.7-flash-low")).toEqual({ mode: "level", level: "low" });
    expect(getModelUpstreamThinkingIntent(alias, "gemini-3.8-flash", "high")).toEqual({ mode: "level", level: "high" });
    // Rows without a preset are not tier variants.
    expect(getModelUpstreamId(alias, "gemini-3.1-pro-low")).toBe("gemini-3.1-pro-low");
    expect(getModelUpstreamThinkingIntent(alias, "claude-sonnet-4-6")).toBeNull();
  });

  it("does not re-route non-Antigravity `<model>-<level>` ids by effort", () => {
    for (const [alias, model] of [["gemini", "gemini-3.8-flash"], ["cx", "gpt-5.3-codex"]]) {
      expect(getModelUpstreamId(alias, model, "high")).toBe(getModelUpstreamId(alias, model));
    }
  });
});

describe("chatCore dispatch of tiered Antigravity models", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["antigravity", "agy"])("%s sends the preset tier without literal parentheses", async (provider) => {
    const { model, body } = await dispatch(provider, "gemini-3.8-flash");
    expect(model).toBe("gemini-3.8-flash-medium");
    expect(body.model).toBe("gemini-3.8-flash-medium");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("medium");
  });

  it.each(["antigravity", "agy"])("%s picks the tier row from body reasoning effort", async (provider) => {
    const { model, body } = await dispatch(provider, "gemini-3.8-flash", { reasoning_effort: "high" });
    expect(model).toBe("gemini-3.8-flash-high");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("request suffix beats body effort", async () => {
    const { model, body } = await dispatch("antigravity", "gemini-3.8-flash(low)", { reasoning_effort: "high" });
    expect(model).toBe("gemini-3.8-flash-low");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
  });
});
