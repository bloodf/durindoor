// handleChatCore wiring for the user-authored custom system prompt.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
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


function run(over = {}, headers = {}) {
  return handleChatCore({
    body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "openai", model: "gpt-4o" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-conn",
    rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json", ...headers } },
    ...over,
  });
}

const sentSystem = () => executeMock.mock.calls[0][0].body.messages.find((m) => m.role === "system")?.content;

describe("handleChatCore custom system prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockImplementation(async () => ({
      response: new Response(JSON.stringify({
        id: "c", object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api.openai.com/v1/chat/completions", headers: {}, transformedBody: null,
    }));
  });

  it("injects the prompt when enabled, without any saver on", async () => {
    await run({ customPromptEnabled: true, customPrompt: "MY PROMPT" });
    expect(sentSystem()).toBe("MY PROMPT");
  });

  it("injects nothing when disabled, even with prompt text", async () => {
    await run({ customPromptEnabled: false, customPrompt: "MY PROMPT" });
    expect(sentSystem()).toBeUndefined();
  });

  it("injects nothing for a blank prompt", async () => {
    await run({ customPromptEnabled: true, customPrompt: "  " });
    expect(sentSystem()).toBeUndefined();
  });

  it("honors the per-request token-saver bypass header", async () => {
    await run({ customPromptEnabled: true, customPrompt: "MY PROMPT" }, { "x-durindoor-token-saver": "off" });
    expect(sentSystem()).toBeUndefined();
  });
});
