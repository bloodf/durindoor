import { beforeEach, describe, expect, test, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
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
  pipeWithDisconnect: vi.fn(() => new ReadableStream({
    start(controller) { controller.close(); },
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", () => ({
  normalizeClaudePassthrough: vi.fn(),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({ injectCaveman: vi.fn() }));
vi.mock("../../open-sse/rtk/ponytail.js", () => ({ injectPonytail: vi.fn() }));
vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
  resolveTokenSaverEnabled: vi.fn(() => true),
}));
vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));
vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
  resolveModelLimits: vi.fn(() => ({ contextWindow: 0, maxOutput: 0, known: false, source: "default" })),
}));
vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
  extractUsageFromResponse: vi.fn((body) => body?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }),
  saveUsageStats: vi.fn(),
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
  sanitizeErrorMessage: vi.fn((message) => String(message || "")),
  readBoundedResponseText: vi.fn((response) => response.text()),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { XaiExecutor } from "../../open-sse/executors/xai.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
describe("xAI OAuth grok-4.5 Responses transport", () => {
  const executor = new XaiExecutor();

  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  test("uses Responses for the OAuth-selected grok-4.5 transport", async () => {
    await executor.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", input: [], stream: true },
      stream: true,
      credentials: {
        accessToken: "oauth-token",
        authType: "oauth",
        runtimeTransport: { format: "openai-responses-oauth", baseUrl: "https://api.x.ai/v1/responses" },
      },
    });

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-4.5", input: [], stream: true });
    expect(init.headers.Authorization).toBe("Bearer oauth-token");
  });

  test("keeps API-key grok-4.5 on Chat Completions", async () => {
    await executor.execute({
      model: "grok-4.5",
      body: { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: "api-key" },
    });

    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false });
    expect(init.headers.Authorization).toBe("Bearer api-key");
  });
});

describe("xAI OAuth grok-4.5 chatCore integration", () => {
  const baseLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "resp-1",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      url: "https://api.x.ai/v1/responses",
      headers: {},
      transformedBody: null,
    });
  });

  const requestBody = { model: "grok-4.5", messages: [{ role: "user", content: "hi" }], stream: false };

  test("chatCore translates messages to input and routes OAuth grok-4.5 through Responses", async () => {
    await handleChatCore({
      body: { ...requestBody },
      modelInfo: { provider: "xai", model: "grok-4.5" },
      credentials: { accessToken: "oauth-token", authType: "oauth" },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: requestBody, headers: {} },
      connectionId: "test-connection",
      log: baseLog,
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const call = executeMock.mock.calls[0][0];
    expect(call.body.input).toBeDefined();
    expect(call.body.messages).toBeUndefined();
    expect(call.credentials.runtimeTransport.baseUrl).toBe("https://api.x.ai/v1/responses");
  });

  test("chatCore keeps API-key grok-4.5 on Chat Completions with plain messages", async () => {
    await handleChatCore({
      body: { ...requestBody },
      modelInfo: { provider: "xai", model: "grok-4.5" },
      credentials: { apiKey: "api-key" },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: requestBody, headers: {} },
      connectionId: "test-connection",
      log: baseLog,
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const call = executeMock.mock.calls[0][0];
    expect(call.body.messages).toBeDefined();
    expect(call.body.input).toBeUndefined();
    expect(call.credentials.runtimeTransport?.baseUrl).not.toBe("https://api.x.ai/v1/responses");
  });
});
