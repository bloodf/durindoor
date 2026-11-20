import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const completion = {
  id: "chatcmpl-test", object: "chat.completion", model: "gpt-4o",
  choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
};
function options(stream, provider = "openai") {
  const body = { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] };
  if (stream !== undefined) body.stream = stream;
  return {
    body, modelInfo: { provider, model: "gpt-4o" },
    credentials: { apiKey: "test", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "test",
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "*/*" } },
  };
}

describe("omitted stream on compatible chat requests", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockImplementation(async () => ({
      response: new Response(JSON.stringify(completion), { headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: null, terminalProvenance: "upstream",
    }));
  });

  it.each(["openai", "deepseek"])("returns JSON for an omitted flag with %s", async (provider) => {
    const result = await handleChatCore(options(undefined, provider));
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect((await result.response.json()).choices[0].message.content).toBe("hello");
    expect(executeMock.mock.calls[0][0].stream).toBe(provider === "openai");
  });

  it.each([true, false])("preserves explicit stream=%s for a forced-stream provider", async (stream) => {
    const result = await handleChatCore(options(stream));
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    expect(await result.response.text()).toContain("[DONE]");
  });

  it("accumulates mandatory upstream SSE for an omitted flag", async () => {
    executeMock.mockResolvedValueOnce({
      response: new Response('data: {"id":"chatcmpl-test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }),
      url: "https://example.test", headers: {}, transformedBody: null, terminalProvenance: "upstream",
    });
    const result = await handleChatCore(options(undefined));
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
    expect(result.response.status).toBe(200);
    expect((await result.response.json()).choices[0].message.content).toBe("hello");
  });

  it("leaves normal Claude CLI warmup bypass intact", async () => {
    const args = options(undefined);
    args.body.messages[0].content = "Warmup";
    args.userAgent = "claude-cli";
    const result = await handleChatCore(args);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    expect(executeMock).not.toHaveBeenCalled();
  });
});
