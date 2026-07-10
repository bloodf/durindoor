import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  headroom: vi.fn(async () => null),
  pxpipe: vi.fn(async () => null),
  trackPending: vi.fn(),
  appendLog: vi.fn(async () => {}),
  refreshCredentials: vi.fn(),
  refreshWithRetry: vi.fn(),
  handleStreamingResponse: vi.fn(),
  detectClientTool: vi.fn(),
  isNativePassthrough: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: mocks.execute,
    refreshCredentials: mocks.refreshCredentials,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: mocks.detectClientTool,
  isNativePassthrough: mocks.isNativePassthrough,
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: () => ({
    signal: undefined,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  }),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: mocks.refreshWithRetry,
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => ({
    onStreamComplete: vi.fn(),
    streamDetailId: "thinking-suffix-detail",
  })),
  handleStreamingResponse: mocks.handleStreamingResponse,
}));

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: mocks.headroom,
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));

vi.mock("../../open-sse/rtk/pxpipe.js", () => ({
  compressWithPxpipe: mocks.pxpipe,
  normalizePxpipeResult: vi.fn((result, diagnostics) => result || ({
    body: null,
    summary: { applied: false, reason: diagnostics.reason || "skipped" },
  })),
  formatPxpipeLog: vi.fn(() => ""),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: mocks.trackPending,
  appendRequestLog: mocks.appendLog,
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("thinking suffix at the chatCore provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockRejectedValue(new Error("stop after boundary capture"));
    mocks.detectClientTool.mockReturnValue(null);
    mocks.isNativePassthrough.mockReturnValue(false);
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({
      success: true,
      response: providerResponse,
    }));
  });

  it("dispatches a native Kiro envelope with clean routing and accounting IDs", async () => {
    const onPxpipeEvent = vi.fn();
    await handleChatCore({
      body: {
        model: "claude-sonnet-4.5(high)",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      modelInfo: { provider: "kiro", model: "claude-sonnet-4.5(high)" },
      credentials: {
        accessToken: "test-token",
        rawHeaders: { "x-session-id": "chatcore-session-144" },
        providerSpecificData: {},
      },
      connectionId: "connection-144",
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "text/event-stream", "x-session-id": "chatcore-session-144" },
      },
      headroomEnabled: true,
      pxpipeEnabled: true,
      onPxpipeEvent,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const call = mocks.execute.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4.5");
    expect(call.body.model).toBeUndefined();
    expect(call.body.messages).toBeUndefined();
    expect(call.body.conversationState.conversationId).toBe("chatcore-session-144");
    expect(call.body.conversationState.currentMessage.userInputMessage.modelId).toBe(
      "claude-sonnet-4.5",
    );
    expect(call.body.conversationState.currentMessage.userInputMessage.content).toContain(
      "<max_thinking_length>24576</max_thinking_length>",
    );
    expect(JSON.stringify(call.body)).not.toContain("(high)");
    expect(Reflect.ownKeys(call.body).filter((key) => String(key).startsWith("_"))).toEqual([]);

    expect(mocks.headroom.mock.calls[0][1].model).toBe("claude-sonnet-4.5");
    expect(mocks.pxpipe.mock.calls[0][1].model).toBe("claude-sonnet-4.5");
    expect(onPxpipeEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: "kiro",
      model: "claude-sonnet-4.5",
    }));
    expect(mocks.trackPending).toHaveBeenCalledWith(
      "claude-sonnet-4.5",
      "kiro",
      "connection-144",
      true,
    );
    expect(mocks.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-sonnet-4.5",
      provider: "kiro",
    }));
  });

  it("keeps clean model and immutable request context across a credential refresh retry", async () => {
    mocks.execute
      .mockResolvedValueOnce({
        response: new Response("unauthorized", { status: 401 }),
        url: "https://kiro.test/first",
        headers: {},
        transformedBody: null,
      })
      .mockResolvedValueOnce({
        response: new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
        url: "https://kiro.test/retry",
        headers: {},
        transformedBody: null,
      });
    mocks.refreshWithRetry.mockResolvedValue({ accessToken: "new-token" });

    const body = {
      model: "claude-sonnet-4.5(8192)",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    };
    await handleChatCore({
      body,
      modelInfo: { provider: "kiro", model: "claude-sonnet-4.5(8192)" },
      credentials: { accessToken: "old-token", providerSpecificData: {} },
      connectionId: "retry-connection-144",
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body,
        headers: { accept: "text/event-stream" },
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const first = mocks.execute.mock.calls[0][0];
    const retry = mocks.execute.mock.calls[1][0];
    expect(first.model).toBe("claude-sonnet-4.5");
    expect(retry.model).toBe("claude-sonnet-4.5");
    expect(first.body).toBe(retry.body);
    expect(first.requestContext).toBe(retry.requestContext);
    expect(Object.isFrozen(first.requestContext)).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain("(8192)");
    expect(first.body.conversationState.currentMessage.userInputMessage.content).toContain(
      "<max_thinking_length>8192</max_thinking_length>",
    );
  });

  it("reconciles a native Claude suffix budget before executor dispatch", async () => {
    mocks.detectClientTool.mockReturnValue("claude");
    mocks.isNativePassthrough.mockReturnValue(true);

    const body = {
      model: "claude-haiku-4-5(8192)",
      max_tokens: 4096,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    };
    await handleChatCore({
      body,
      modelInfo: { provider: "claude", model: "claude-haiku-4-5(8192)" },
      credentials: { accessToken: "claude-token", providerSpecificData: {} },
      connectionId: "claude-connection-144",
      clientRawRequest: {
        endpoint: "/v1/messages",
        body,
        headers: { accept: "text/event-stream", "anthropic-version": "2023-06-01" },
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const call = mocks.execute.mock.calls[0][0];
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.body.model).toBe("claude-haiku-4-5");
    expect(call.body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(call.body.max_tokens).toBe(9216);
    expect(call.body.thinking.budget_tokens).toBeLessThan(call.body.max_tokens);
  });
});
