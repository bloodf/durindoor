// Command Code through chatCore: the outbound validation gate must accept the
// { memory, config, params } envelope that openai-to-commandcode produces.
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
  finishActiveSession: vi.fn(),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { validateOutboundPayload } = await import("../../open-sse/translator/validate.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

function chatCoreOptions(messages) {
  const body = { model: "commandcode/deepseek/deepseek-v4-flash", stream: true, messages };
  return {
    body,
    modelInfo: { provider: "commandcode", model: "deepseek/deepseek-v4-flash" },
    credentials: { apiKey: "user_test", connectionId: "cc-conn", providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "text/event-stream" } },
    connectionId: "cc-conn",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("Command Code outbound validation in chatCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.execute.mockResolvedValue({
      response: new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      url: "https://api.commandcode.ai/alpha/generate",
      headers: {},
      transformedBody: null,
    });
  });

  it("dispatches the envelope instead of rejecting it with 400", async () => {
    const result = await handleChatCore(chatCoreOptions([
      { role: "user", content: "run pwd" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: '{"command":"pwd"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "/tmp" },
    ]));

    expect(result.status).not.toBe(400);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const sent = mocks.execute.mock.calls[0][0].body;
    expect(sent.params.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("answers a malformed tool history with 400 instead of throwing", async () => {
    const result = await handleChatCore(chatCoreOptions([
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: "{not json" } }] },
      { role: "tool", tool_call_id: "call_1", content: "/tmp" },
    ]));

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(result.error).toContain("invalid arguments");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("still rejects an envelope with no params.messages", () => {
    expect(validateOutboundPayload(FORMATS.COMMANDCODE, { params: { model: "m", messages: [] } })).toMatchObject({ ok: false });
    expect(validateOutboundPayload(FORMATS.COMMANDCODE, { messages: [{ role: "user", content: "x" }] })).toMatchObject({ ok: false });
  });
});
