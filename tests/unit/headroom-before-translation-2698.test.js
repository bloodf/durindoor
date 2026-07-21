import { beforeEach, describe, expect, it, vi } from "vitest";

// #2698: headroom compression must run BEFORE translation, on the SOURCE body
// and with the sourceFormat, so every output format is covered (not just the
// openai/claude target shapes). Assert the compressWithHeadroom call shape.

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  handleStreamingResponse: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
  compressWithHeadroom: vi.fn(async () => null),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: false, execute: mocks.execute })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined, startTime: Date.now(), isConnected: () => true,
    handleComplete: vi.fn(), handleError: vi.fn(), handleDisconnect: vi.fn(), abort: vi.fn(),
  })),
}));

vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: mocks.handleStreamingResponse,
}));

vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: mocks.handleNonStreamingResponse,
}));

vi.mock("../../open-sse/rtk/headroom.js", async (importOriginal) => ({
  ...(await importOriginal()),
  compressWithHeadroom: mocks.compressWithHeadroom,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("#2698 — headroom runs before translation on the source body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compressWithHeadroom.mockResolvedValue(null);
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.execute.mockResolvedValue({
      response: new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      url: "https://provider.test/v1/chat/completions",
      headers: {},
      transformedBody: { model: "m", messages: [] },
    });
  });

  it("calls compressWithHeadroom with the sourceFormat (not the translated target) and the source body", async () => {
    // openai client -> claude-format target: pre-move headroom used the target
    // (claude); post-move it must use the sourceFormat (openai). This cross-format
    // request is what makes the assertion meaningful.
    const body = { model: "claude/claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }], stream: true };
    await handleChatCore({
      body,
      modelInfo: { provider: "claude", model: "claude-sonnet-4-5" },
      credentials: { apiKey: "k", connectionId: "c1", providerSpecificData: {} },
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} },
      connectionId: "c1",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.compressWithHeadroom).toHaveBeenCalledTimes(1);
    const [passedBody, opts] = mocks.compressWithHeadroom.mock.calls[0];
    // Source format (openai) — NOT the claude target format.
    expect(opts.format).toBe("openai");
    expect(opts.enabled).toBe(true);
    // Compresses the source body (openai messages shape).
    expect(Array.isArray(passedBody.messages)).toBe(true);
  });
});
