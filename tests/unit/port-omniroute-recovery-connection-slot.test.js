import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { getGateStats, _resetGates } from "../../open-sse/services/concurrencyGate.js";
import { resetPayloadAdmission } from "../../open-sse/services/payloadAdmission.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  headroom: vi.fn(async () => null),
  pxpipe: vi.fn(async () => null),
  trackPending: vi.fn(),
  finishSession: vi.fn(),
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
  isCodexOriginatedHeaders: vi.fn(() => false),
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
    streamDetailId: "slot-recovery-detail",
  })),
  handleStreamingResponse: mocks.handleStreamingResponse,
}));

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: mocks.headroom,
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
  classifyHeadroomDiagnostic: (reason) => reason,
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
  finishActiveSession: mocks.finishSession,
  appendRequestLog: mocks.appendLog,
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const reply = (status, payload) => ({
  response: new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }),
  url: "https://upstream.invalid/v1/messages",
  headers: {},
  transformedBody: {},
});

describe("connection slot held through delivery (OmniRoute #21163, 98be2269)", () => {
  beforeEach(() => {
    _resetGates();
    resetPayloadAdmission();
    vi.clearAllMocks();
    mocks.execute.mockReset();
    mocks.detectClientTool.mockReturnValue(null);
    mocks.isNativePassthrough.mockReturnValue(false);
    mocks.handleStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
  });

  it("keeps the slot while a recovered thinking-signature retry is still being delivered", async () => {
    // Only a native Claude passthrough still carries historical thinking to strip.
    mocks.detectClientTool.mockReturnValue("claude");
    mocks.isNativePassthrough.mockReturnValue(true);
    mocks.execute
      .mockResolvedValueOnce(reply(400, { error: { type: "invalid_request_error", message: "Invalid signature in thinking block" } }))
      .mockResolvedValueOnce(reply(200, {}));

    const result = await handleChatCore({
      body: {
        model: "claude-sonnet-4.5",
        stream: true,
        max_tokens: 100,
        messages: [
          { role: "user", content: [{ type: "text", text: "q" }] },
          { role: "assistant", content: [{ type: "thinking", thinking: "t", signature: Buffer.from([0x12, 1, 2, 3, 4, 5, 6, 7, 8]).toString("base64") }, { type: "text", text: "a" }] },
          { role: "user", content: [{ type: "text", text: "q2" }] },
        ],
      },
      modelInfo: { provider: "claude", model: "claude-sonnet-4.5" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      connectionId: "connection-slot-recovery",
      clientRawRequest: { endpoint: "/v1/messages", body: {}, headers: { accept: "text/event-stream" } },
      sourceFormatOverride: "claude",
      globalConcurrentRequests: 1,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    // The mocked streaming handler never ends the stream, so the slot is still in use.
    expect(getGateStats().__global__).toEqual({ current: 1, queued: 0 });
  });
});
