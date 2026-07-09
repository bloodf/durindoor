import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
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

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function okResponse() {
  return {
    response: new Response(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }),
    url: "https://api.anthropic.com/v1/messages",
    headers: {},
    transformedBody: null,
  };
}

describe("handleChatCore pxpipe fail-open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue(okResponse());
  });

  it("continues the request when pxpipe returns null for an unsupported Claude model", async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const onPxpipeEvent = vi.fn();

    const result = await handleChatCore({
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 16,
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
      modelInfo: { provider: "anthropic", model: "claude-haiku-4-5" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log,
      connectionId: "pxpipe-null-contract",
      pxpipeEnabled: true,
      pxpipeMinChars: 1000,
      pxpipeTimeoutMs: 50,
      // Present so the only reason to short-circuit is the model gate (null contract).
      pxpipeTransform: vi.fn(async () => {
        throw new Error("transform must not run for unsupported models");
      }),
      onPxpipeEvent,
      rtkEnabled: false,
      headroomEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/messages",
        body: {},
        headers: { accept: "application/json" },
      },
    });

    expect(result?.success !== false || result?.response).toBeTruthy();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith(
      "PXPIPE",
      expect.stringMatching(/skipped: unsupported_model/)
    );
    // Event hook must also tolerate the null contract summary.
    expect(onPxpipeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ applied: false, reason: "unsupported_model" })
    );
  });
});
