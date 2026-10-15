import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  streaming: vi.fn(),
  nonStreaming: vi.fn(),
}));

// Keep the registered translators and HTTP error builder real; isolate provider
// dispatch and persistence so acceptance tests need no accounts or network.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "test-agent",
  updateKimchiUserAgent: async () => "test-agent",
}));
vi.mock("@/lib/localDb.js", () => ({ getProviderConnections: vi.fn(async () => []) }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "cursor", model: "default" }),
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {},
    logProviderResponse() {}, logConvertedResponse() {}, logError() {},
  }),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: () => null,
  isNativePassthrough: () => false,
  isCodexOriginatedHeaders: () => false,
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: () => ({
    signal: undefined, startTime: Date.now(), isConnected: () => true,
    handleComplete() {}, handleError() {}, handleDisconnect() {}, abort() {},
  }),
}));
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: () => () => {},
  handleStreamingResponse: mocks.streaming,
}));
vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: mocks.nonStreaming,
}));
vi.mock("../../open-sse/handlers/countTokensCore.js", () => ({
  estimateTokens: () => 1,
  countInputTokens: async () => ({ tokens: 1, approximate: true }),
}));
vi.mock("../../open-sse/services/liveModelLimits.js", () => ({ getCachedLiveLimits: () => null }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: () => null, record() {}, finishTrace() {}, attachClientFrameTap() {},
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest() {}, finishActiveSession() {},
  appendRequestLog: async () => {}, saveRequestDetail: async () => {},
}));

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { POST } from "../../src/app/api/translator/translate/route.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockImplementation(async ({ body, stream }) => ({
    response: new Response(stream ? "data: [DONE]\n\n" : JSON.stringify({
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    }), { headers: { "content-type": stream ? "text/event-stream" : "application/json" } }),
    url: "https://upstream.invalid/agent", headers: {}, transformedBody: body,
  }));
  for (const handler of [mocks.streaming, mocks.nonStreaming]) {
    handler.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
  }
});

describe("translator console internal errors", () => {
  it.each([undefined, "400", 401, 500])("keeps non-validation statusCode=%j failures as 500", async (statusCode) => {
    const response = await POST({
      json: async () => { throw Object.assign(new Error("internal failure"), { statusCode }); },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "internal failure" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

function chat(body) {
  return handleChatCore({
    body: { model: "cu/default", messages: [{ role: "user", content: "hi" }], ...body },
    modelInfo: { provider: "cursor", model: "default" },
    credentials: { providerSpecificData: {} },
    clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
    skipPonytailCommands: true,
  });
}

for (const stream of [true, false]) {
  describe(`Cursor acceptance stream=${stream}`, () => {
    it.each([
      ["max_tokens", 200, "Cursor transport does not support max_tokens; explicit output-token limits cannot be enforced"],
      ["max_completion_tokens", 200, "Cursor transport does not support max_completion_tokens; explicit output-token limits cannot be enforced"],
      ["max_tokens", 0, "max_tokens must be a positive integer"],
      ["max_completion_tokens", "200", "max_completion_tokens must be a positive integer"],
    ])("returns a client-visible JSON 400 for %s=%j before dispatch", async (field, cap, message) => {
      const result = await chat({ stream, [field]: cap });
      expect(result.success).toBe(false);
      expect(result.response.status).toBe(400);
      expect(result.response.headers.get("content-type")).toContain("application/json");
      expect(await result.response.json()).toMatchObject({
        error: { type: "invalid_request_error", message },
      });
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.streaming).not.toHaveBeenCalled();
      expect(mocks.nonStreaming).not.toHaveBeenCalled();
    });

    it("dispatches uncapped requests through the negotiated response path", async () => {
      const result = await chat({ stream });
      expect(result.success).toBe(true);
      expect(result.response.status).toBe(200);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      const dispatched = mocks.execute.mock.calls[0][0];
      expect(dispatched.stream).toBe(stream);
      expect(dispatched.body.messages).toEqual([{ role: "user", content: "hi" }]);
      expect(dispatched.body.max_tokens).toBeUndefined();
      expect(dispatched.body.max_completion_tokens).toBeUndefined();
      expect(stream ? mocks.streaming : mocks.nonStreaming).toHaveBeenCalledTimes(1);
      expect(stream ? mocks.nonStreaming : mocks.streaming).not.toHaveBeenCalled();
    });

    it.each([
      ["max_tokens", 200, "Cursor transport does not support max_tokens; explicit output-token limits cannot be enforced"],
      ["max_completion_tokens", 200, "Cursor transport does not support max_completion_tokens; explicit output-token limits cannot be enforced"],
      ["max_tokens", 0, "max_tokens must be a positive integer"],
      ["max_completion_tokens", "200", "max_completion_tokens must be a positive integer"],
    ])("returns 400 from the translator console for %s=%j", async (field, cap, message) => {
      const response = await POST({
        json: async () => ({
          step: 3,
          body: {
            provider: "cursor", model: "default",
            body: { stream, [field]: cap, messages: [{ role: "user", content: "hi" }] },
          },
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        error: message,
      });
      expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("rejects a Responses output cap after the registered OpenAI pivot", () => {
      expect(() => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.CURSOR, "default", {
        input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
        max_output_tokens: 200,
      }, stream, null, "cursor")).toThrowError(expect.objectContaining({
        statusCode: 400,
        message: "Cursor transport does not support max_tokens; explicit output-token limits cannot be enforced",
      }));
    });
  });
}
