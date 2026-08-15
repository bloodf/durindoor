import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: false, execute: mocks.execute })),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: mocks.createRequestLogger,
}));
vi.mock("open-sse/providers/shared.js", () => ({
  ANTIGRAVITY_OAUTH_CLIENT: {},
  GOOGLE_OAUTH_CLIENT: {},
}));
vi.mock("open-sse/providers/index.js", () => ({
  PROVIDER_OAUTH: {},
  PROVIDERS: {},
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null), isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({ signal: undefined, startTime: Date.now(), isConnected: () => true, handleComplete: vi.fn(), handleError: vi.fn(), handleDisconnect: vi.fn(), abort: vi.fn() })),
}));
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({ buildOnStreamComplete: vi.fn(() => vi.fn()), handleStreamingResponse: vi.fn() }));
vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({ handleNonStreamingResponse: mocks.handleNonStreamingResponse }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function options(model) {
  const body = { model, messages: [{ role: "user", content: "hi" }], stream: false };
  return {
    body, modelInfo: { provider: "openai", model }, credentials: { apiKey: "test" },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
    sourceFormatOverride: FORMATS.OPENAI, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}
describe("chatCore model lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("rejects shutdown requested model before executor dispatch", async () => {
    const result = await handleChatCore(options("gpt-5.2-codex"));
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.createRequestLogger).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, status: 410 });
    await expect(result.response.json()).resolves.toMatchObject({ error: { type: "invalid_request_error", code: "model_shutdown", message: expect.stringMatching(/gpt-5.2-codex/) } });
  });

  it("allows active model and only warns for deprecated model", async () => {
    mocks.execute.mockResolvedValue({ response: new Response("{}", { status: 200 }), url: "https://upstream.test", headers: {}, transformedBody: {} });
    mocks.handleNonStreamingResponse.mockResolvedValue({ success: true, response: new Response("{}") });
    const active = options("gpt-4o");
    await handleChatCore(active);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const deprecated = options("gpt-3.5-turbo-0125");
    await handleChatCore(deprecated);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(deprecated.log.warn).toHaveBeenCalledWith("MODEL_LIFECYCLE", expect.stringMatching(/deprecated/));
  });
});
