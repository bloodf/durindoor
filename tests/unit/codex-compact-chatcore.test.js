import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  refreshCredentials: vi.fn(),
  refreshWithRetry: vi.fn(),
  handleStreamingResponse: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
  isCodexOriginatedHeaders: vi.fn(() => false),
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  logClientRawRequest: vi.fn(),
  logRawRequest: vi.fn(),
  logTargetRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
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
  detectClientTool: mocks.detectClientTool,
  isNativePassthrough: mocks.isNativePassthrough,
  isCodexOriginatedHeaders: mocks.isCodexOriginatedHeaders,
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
  appendRequestLog: mocks.appendRequestLog,
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
    // clearAllMocks clears calls, not implementations — pin the detector to
    // non-Codex by default; echo tests opt in explicitly.
    mocks.isCodexOriginatedHeaders.mockReturnValue(false);
    mocks.detectClientTool.mockReturnValue(null);
    mocks.isNativePassthrough.mockReturnValue(false);
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.handleNonStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.refreshWithRetry.mockResolvedValue({ accessToken: "new-token" });
  });
  it("normalizes Codex additional_tools items without removing their tools", async () => {
    mocks.detectClientTool.mockReturnValue("codex");
    mocks.isNativePassthrough.mockReturnValue(true);
    mocks.execute.mockResolvedValue(providerResult(200));
    const options = makeOptions({ endpoint: "/v1/responses" });
    options.body.input.unshift({
      type: "additional_tools",
      content: [{ type: "input_text", text: "must not reach Codex" }],
      tools: [{ type: "web_search" }],
    });
    options.body.tools = [{ type: "function", name: "lookup" }];

    await handleChatCore(options);

    const outbound = mocks.execute.mock.calls[0][0].body;
    expect(outbound.input[0]).toEqual({
      type: "additional_tools",
      tools: [{ type: "web_search" }],
    });
    expect(outbound.tools).toEqual([{ type: "function", name: "lookup" }]);
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
    });
    expect(Object.isFrozen(first.requestContext)).toBe(true);
    expect(Object.isFrozen(first.requestContext.clientHeaders)).toBe(true);
    expect(first.body).not.toHaveProperty("_compact");
    expect(second.body).not.toHaveProperty("_compact");
    expect(options.credentials).not.toHaveProperty("_isCompact");
  });

  it("keeps provider and Codex session identity stable across correlated turns", async () => {
    const wireRequests = [];
    mocks.execute.mockImplementation(async ({ model, body, stream, credentials, requestContext }) => {
      const executor = new CodexExecutor();
      wireRequests.push({
        requestContext,
        headers: executor.buildHeaders(credentials, stream, requestContext),
        body: executor.transformRequest(model, structuredClone(body), stream, credentials, requestContext),
      });
      return providerResult(200);
    });
    const first = makeOptions({ endpoint: "/v1/responses" });
    const second = makeOptions({ endpoint: "/v1/responses" });
    first.clientRawRequest.requestId = "11111111-1111-4111-8111-111111111111";
    second.clientRawRequest.requestId = "22222222-2222-4222-8222-222222222222";

    await handleChatCore(first);
    await handleChatCore(second);

    expect(wireRequests).toHaveLength(2);
    expect(wireRequests[0].requestContext).not.toBe(wireRequests[1].requestContext);
    expect(wireRequests[0].requestContext.sessionId).toBe("request-session");
    expect(wireRequests[1].requestContext.sessionId).toBe(wireRequests[0].requestContext.sessionId);
    expect(wireRequests.map(({ requestContext }) => requestContext.requestId)).toEqual([
      first.clientRawRequest.requestId,
      second.clientRawRequest.requestId,
    ]);
    expect(wireRequests[0].headers.session_id).toBe("request-session");
    expect(wireRequests[1].headers.session_id).toBe(wireRequests[0].headers.session_id);
    expect(wireRequests[0].body.prompt_cache_key).toBe("request-session");
    expect(wireRequests[1].body.prompt_cache_key).toBe(wireRequests[0].body.prompt_cache_key);
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

  function lifecycleSseResult({ provider = "openai", upstreamModel = "gpt-5.5" } = {}) {
    const frames = [
      'data: {"type":"response.created","response":{"id":"resp_1","object":"response","model":"' + upstreamModel + '","status":"in_progress"}}',
      'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"' + upstreamModel + '","status":"completed"}}',
      "data: [DONE]",
    ].join("\n\n") + "\n\n";
    return {
      response: new Response(frames, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      url: `https://${provider}.test/responses`,
      headers: {},
      transformedBody: { model: upstreamModel, input: [] },
    };
  }

  it("echoes the ORIGINAL combo client model when Codex-originated and non-compact, regardless of routed provider", async () => {
    // Client asked the combo for codex/gpt-5.5-xhigh; combo routed to a
    // NON-Codex upstream. Echo must reflect the client id, not the routed id.
    mocks.isCodexOriginatedHeaders.mockReturnValue(true);
    mocks.execute.mockResolvedValue(lifecycleSseResult({ provider: "openai", upstreamModel: "gpt-5.5" }));
    const options = makeOptions({ endpoint: "/v1/responses" });
    options.modelInfo = { provider: "openai", model: "gpt-5.5" };
    options.clientRawRequest.body = { ...options.body, model: "codex/gpt-5.5-xhigh" };
    options.body = options.clientRawRequest.body;

    const result = await handleChatCore(options);

    const text = await result.response.text();
    const created = text.match(/data: (\{[^\n]*response\.created[^\n]*\})/);
    expect(JSON.parse(created[1]).response.model).toBe("codex/gpt-5.5-xhigh");
  });

  it("does NOT echo on compact requests (unary JSON contract stays untouched)", async () => {
    mocks.isCodexOriginatedHeaders.mockReturnValue(true);
    // Compact forces non-streaming dispatch; the upstream returns unary JSON.
    mocks.handleNonStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    const jsonBody = { id: "resp_1", object: "response", model: "gpt-5.5", status: "completed", output: [] };
    const jsonResponse = new Response(JSON.stringify(jsonBody), { status: 200, headers: { "Content-Type": "application/json" } });
    mocks.execute.mockResolvedValue({
      response: jsonResponse,
      url: "https://openai.test/responses",
      headers: {},
      transformedBody: { model: "gpt-5.5", input: [] },
    });
    const options = makeOptions({ endpoint: "/v1/responses/compact" });
    options.clientRawRequest.body = { ...options.body, model: "codex/gpt-5.5-xhigh" };
    options.body = options.clientRawRequest.body;

    const result = await handleChatCore(options);

    // Compact → non-streaming dispatch, and no echo on the unary JSON.
    expect(mocks.handleNonStreamingResponse).toHaveBeenCalledOnce();
    expect(mocks.handleStreamingResponse).not.toHaveBeenCalled();
    const out = await result.response.json();
    expect(out.model).toBe("gpt-5.5");
  });
  function claudeEchoOptions({ originalModel, provider, physicalModel }) {
    const body = {
      model: physicalModel,
      stream: true,
      max_tokens: 64,
      messages: [{ role: "user", content: "hello" }],
    };
    return baseClaudeOptions({
      body,
      modelInfo: { provider, model: physicalModel },
      clientRawRequest: {
        endpoint: "/v1/messages",
        body: { ...body, model: originalModel },
        originalModel,
        headers: { accept: "text/event-stream", "anthropic-version": "2023-06-01" },
      },
      sourceFormatOverride: "claude",
    });
  }

  function baseClaudeOptions(overrides) {
    return {
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      connectionId: "test-conn",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    };
  }

  function claudeMessageStart(physicalModel) {
    const frame = `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", model: physicalModel, content: [] },
    })}\n\n`;
    return {
      response: new Response(frame, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      url: "https://provider.test/messages",
      headers: {},
      transformedBody: { model: physicalModel },
    };
  }

  it("echoes the original Claude combo alias while dispatch retains physical identity", async () => {
    const originalModel = "claude-fast[1m]";
    mocks.execute.mockResolvedValue(claudeMessageStart("gpt-5.5"));

    const result = await handleChatCore(claudeEchoOptions({
      originalModel,
      provider: "openai",
      physicalModel: "gpt-5.5",
    }));

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5" }));
    expect(mocks.logRawRequest).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5" }));
    expect(mocks.appendRequestLog).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5", provider: "openai" }));
    expect(await result.response.text()).toContain(`"model":"${originalModel}"`);
  });

  it("echoes the original Claude alias across an Antigravity Gemini route", async () => {
    const originalModel = "claude-antigravity/gemini-3.1-pro";
    mocks.execute.mockResolvedValue(claudeMessageStart("gemini-3.1-pro"));

    const result = await handleChatCore(claudeEchoOptions({
      originalModel,
      provider: "antigravity",
      physicalModel: "gemini-3.1-pro",
    }));

    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.1-pro" }));
    expect(mocks.logRawRequest).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.1-pro" }));
    expect(mocks.appendRequestLog).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.1-pro", provider: "antigravity" }));
    expect(await result.response.text()).toContain(`"model":"${originalModel}"`);
  });

});
