import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    noAuth: true,
    execute: executeMock,
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
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({ injectCaveman: vi.fn() }));
vi.mock("../../open-sse/rtk/ponytail.js", () => ({ injectPonytail: vi.fn() }));
vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
}));
vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));
vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
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
}));
vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function makeOptions(sourceFormat, body, provider = "openai") {
  return {
    body,
    modelInfo: { provider, model: provider === "gemini" ? "gemini-pro" : "gpt-4.1" },
    credentials: { apiKey: "sk-test", providerSpecificData: {} },
    sourceFormatOverride: sourceFormat,
    connectionId: `gemini-runtime-${sourceFormat}`,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    pxpipeEnabled: false,
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
  };
}

describe.each([FORMATS.GEMINI, FORMATS.GEMINI_CLI])(
  "handleChatCore preserves %s functionResponse history at the executor boundary",
  (sourceFormat) => {
    beforeEach(() => {
      vi.clearAllMocks();
      executeMock.mockRejectedValue(new Error("executor capture"));
    });

    it("preserves an orphan functionResponse", async () => {
      const body = {
        model: "gemini-pro",
        contents: [{
          role: "user",
          parts: [{
            functionResponse: {
              id: "call_orphan",
              name: "lookup",
              response: { result: "orphan-survives" },
            },
          }],
        }],
      };

      await handleChatCore(makeOptions(sourceFormat, body));

      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(executeMock.mock.calls[0][0].body)).toContain("orphan-survives");
    });

    it("preserves co-located functionResponse and functionCall parts", async () => {
      const body = {
        model: "gemini-pro",
        contents: [{
          role: "model",
          parts: [
            {
              functionResponse: {
                id: "call_prior",
                name: "lookup",
                response: { result: "co-located-survives" },
              },
            },
            {
              functionCall: {
                id: "call_next",
                name: "lookup",
                args: { query: "next" },
              },
            },
          ],
        }],
      };

      await handleChatCore(makeOptions(sourceFormat, body));

      expect(executeMock).toHaveBeenCalledTimes(1);
      const executorBody = JSON.stringify(executeMock.mock.calls[0][0].body);
      expect(executorBody).toContain("co-located-survives");
      expect(executorBody).toContain("call_next");
    });

    it("preserves only eligible native functionResponses while cleaning mixed orphan shapes", async () => {
      const body = {
        model: "gemini-pro",
        messages: [{ role: "tool", tool_call_id: "message_orphan", content: "DROP_MESSAGE_ORPHAN" }],
        input: [{ type: "function_call_output", call_id: "input_orphan", output: "DROP_INPUT_ORPHAN" }],
        contents: [{
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call_eligible",
                name: "lookup",
                response: { result: "KEEP_ELIGIBLE_RESPONSE" },
              },
            },
            { functionResponse: [{ result: "DROP_ARRAY_FUNCTION_RESPONSE" }] },
            {
              functionResponse: {
                id: " ",
                name: " ",
                response: { result: "DROP_BLANK_ID_RESPONSE" },
              },
            },
            {
              functionResponse: {
                id: "call_array_response",
                name: "lookup",
                response: ["DROP_ARRAY_RESPONSE"],
              },
            },
          ],
        }],
      };

      await handleChatCore(makeOptions(sourceFormat, body, "gemini"));

      expect(executeMock).toHaveBeenCalledTimes(1);
      const executorBody = JSON.stringify(executeMock.mock.calls[0][0].body);
      expect(executorBody).toContain("KEEP_ELIGIBLE_RESPONSE");
      expect(executorBody).not.toContain("DROP_MESSAGE_ORPHAN");
      expect(executorBody).not.toContain("DROP_INPUT_ORPHAN");
      expect(executorBody).not.toContain("DROP_ARRAY_FUNCTION_RESPONSE");
      expect(executorBody).not.toContain("DROP_BLANK_ID_RESPONSE");
      expect(executorBody).not.toContain("DROP_ARRAY_RESPONSE");
    });
  },
);

describe("handleChatCore does not extend native Gemini preservation to Antigravity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockRejectedValue(new Error("executor capture"));
  });

  it("cleans an orphan functionResponse before Antigravity executor dispatch", async () => {
    const body = {
      model: "gemini-pro",
      contents: [{
        role: "user",
        parts: [{
          functionResponse: {
            id: "call_antigravity_orphan",
            name: "lookup",
            response: { result: "DROP_ANTIGRAVITY_ORPHAN" },
          },
        }, { text: "keep this turn valid" }],
      }],
    };

    await handleChatCore(makeOptions(FORMATS.ANTIGRAVITY, body, "antigravity"));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(executeMock.mock.calls[0][0].body)).not.toContain("DROP_ANTIGRAVITY_ORPHAN");
  });
});
