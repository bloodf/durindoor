import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  refreshCredentials: vi.fn(),
  refreshWithRetry: vi.fn(),
  handleStreamingResponse: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
  logClientRawRequest: vi.fn(),
  logRawRequest: vi.fn(),
  logTargetRequest: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: false,
    execute: mocks.execute,
    refreshCredentials: mocks.refreshCredentials,
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: mocks.logClientRawRequest,
    logRawRequest: mocks.logRawRequest,
    logTargetRequest: mocks.logTargetRequest,
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
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
  refreshWithRetry: mocks.refreshWithRetry,
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: mocks.handleStreamingResponse,
}));

vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: mocks.handleNonStreamingResponse,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function providerResult(status) {
  return {
    response: new Response(status === 200 ? "data: [DONE]\n\n" : "unauthorized", {
      status,
      headers: { "Content-Type": status === 200 ? "text/event-stream" : "text/plain" },
    }),
    url: "https://chatgpt.test/backend-api/codex/responses",
    headers: {},
    transformedBody: { model: "gpt-5.3-codex", input: [] },
  };
}

function makeOptions({ endpoint = "/v1/responses/compact", legacyMarker = false } = {}) {
  const body = {
    model: "cx/gpt-5.3-codex",
    input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    stream: true,
    ...(legacyMarker ? { _compact: true } : {}),
  };
  return {
    body,
    modelInfo: { provider: "codex", model: "gpt-5.3-codex" },
    credentials: { accessToken: "old-token", connectionId: "codex-connection", providerSpecificData: {} },
    clientRawRequest: {
      endpoint,
      body,
      headers: { accept: "text/event-stream", "x-session-id": "request-session" },
    },
    connectionId: "codex-connection",
    sourceFormatOverride: "openai-responses",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("Codex compact request context in chatCore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.handleNonStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.refreshWithRetry.mockResolvedValue({ accessToken: "new-token" });
  });

  it("keeps the same frozen compact context across OAuth refresh retry", async () => {
    mocks.execute
      .mockResolvedValueOnce(providerResult(401))
      .mockResolvedValueOnce(providerResult(200));
    const options = makeOptions();
    options.modelInfo.model = "gpt-5.3-codex-high";
    options.refreshCredentials = vi.fn().mockResolvedValue({ accessToken: "new-token" });

    await handleChatCore(options);

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const first = mocks.execute.mock.calls[0][0];
    const second = mocks.execute.mock.calls[1][0];
    expect(first.requestContext).toBe(second.requestContext);
    expect(first.requestContext).toMatchObject({
      compact: true,
      clientHeaders: { "x-session-id": "request-session" },
      requestedModel: "gpt-5.3-codex-high",
    });
    expect(second.requestContext.requestedModel).toBe("gpt-5.3-codex-high");
    expect(Object.isFrozen(first.requestContext)).toBe(true);
    expect(Object.isFrozen(first.requestContext.clientHeaders)).toBe(true);
    expect(first.body).not.toHaveProperty("_compact");
    expect(second.body).not.toHaveProperty("_compact");
    expect(options.credentials).not.toHaveProperty("_isCompact");
  });

  it("keeps strict-pool routing on the 401 refresh and request retry", async () => {
    mocks.execute
      .mockResolvedValueOnce(providerResult(401))
      .mockResolvedValueOnce(providerResult(200));
    const options = makeOptions();
    const sharedRefresh = vi.fn().mockResolvedValue({ accessToken: "new-token" });
    options.refreshCredentials = sharedRefresh;
    options.credentials.providerSpecificData = {
      oauthProxy: { mode: "strict-pool", poolId: "pool-chat" },
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://chat-proxy.test:8080",
      connectionNoProxy: "localhost",
      connectionProxyPoolId: "pool-chat",
      strictProxy: true,
      disableEnvProxy: true,
    };

    await handleChatCore(options);

    const firstRoute = mocks.execute.mock.calls[0][0].proxyOptions;
    const retryRoute = mocks.execute.mock.calls[1][0].proxyOptions;
    expect(firstRoute).toBe(retryRoute);
    expect(firstRoute).toMatchObject({
      proxyMode: "strict-pool",
      proxyPoolId: "pool-chat",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://chat-proxy.test:8080",
      strictProxy: true,
      disableEnvProxy: true,
    });
    expect(sharedRefresh).toHaveBeenCalledWith({ signal: null, force: true });
    expect(mocks.refreshCredentials).not.toHaveBeenCalled();
    const proxyLogs = options.log.info.mock.calls.flat().join(" ");
    expect(proxyLogs).toContain("http://chat-proxy.test:8080");
    expect(proxyLogs).not.toContain("@chat-proxy.test");
  });

  it("never logs proxy userinfo or relay query secrets", async () => {
    mocks.execute.mockResolvedValue(providerResult(200));
    const proxied = makeOptions();
    proxied.credentials.providerSpecificData = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://alice:proxy-secret@proxy.test:8443/private?token=relay-secret",
      connectionProxyPoolId: "pool-secret-test",
    };

    await handleChatCore(proxied);

    const logs = proxied.log.info.mock.calls.flat().join(" ");
    expect(logs).toContain("http://proxy.test:8443");
    expect(logs).not.toContain("alice");
    expect(logs).not.toContain("proxy-secret");
    expect(logs).not.toContain("relay-secret");
  });

  it("accepts but strips the legacy marker before logs, dispatch, and persistence", async () => {
    mocks.execute.mockResolvedValueOnce(providerResult(200));
    const options = makeOptions({ endpoint: "/v1/responses", legacyMarker: true });

    await handleChatCore(options);

    expect(mocks.execute.mock.calls[0][0].requestContext.compact).toBe(true);
    expect(mocks.execute.mock.calls[0][0].body).not.toHaveProperty("_compact");
    expect(mocks.logClientRawRequest.mock.calls[0][1]).not.toHaveProperty("_compact");
    expect(mocks.logRawRequest.mock.calls[0][0]).not.toHaveProperty("_compact");
    expect(mocks.handleNonStreamingResponse).toHaveBeenCalledOnce();
    expect(mocks.handleStreamingResponse).not.toHaveBeenCalled();
    expect(mocks.handleNonStreamingResponse.mock.calls[0][0].body).not.toHaveProperty("_compact");
    expect(options.credentials).not.toHaveProperty("_isCompact");
  });
});
