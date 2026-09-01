import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => "claude"),
  isNativePassthrough: vi.fn(() => true),
  isCodexOriginatedHeaders: vi.fn(() => false),
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
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("handleChatCore native Claude foreign server tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockRejectedValue(new Error("stop after outbound capture"));
  });

  it("sanitizes outbound history while preserving foreign result content", async () => {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [{ type: "server_tool_use", id: "call_foreign_native", name: "web_search", input: {} }],
        },
        {
          role: "user",
          content: [{
            type: "web_search_tool_result",
            tool_use_id: "call_foreign_native",
            content: [
              { type: "web_search_result", title: "Kept result", url: "https://result.test" },
              { type: "text", text: "verbatim native route content" },
            ],
          }],
        },
      ],
    };

    await handleChatCore({
      body,
      modelInfo: { provider: "claude", model: "claude-sonnet-4-6" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      connectionId: "foreign-server-tool-native-route",
      clientRawRequest: {
        endpoint: "/v1/messages",
        body,
        headers: {
          "anthropic-version": "2023-06-01",
          "user-agent": "claude-cli/2.1.0",
          "x-9router-assistant-prefill": "preserve",
        },
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.execute).toHaveBeenCalledOnce();
    const outbound = mocks.execute.mock.calls[0][0].body;
    const serialized = JSON.stringify(outbound);
    expect(serialized).not.toContain('"tool_use_id":"call_foreign_native"');
    expect(serialized).not.toContain("server_tool_use");
    expect(serialized).not.toContain("web_search_tool_result");
    expect(serialized).toContain("Kept result");
    expect(serialized).toContain("verbatim native route content");
    expect(outbound.messages).toEqual([{
      role: "user",
      content: [expect.objectContaining({ type: "text" })],
    }]);
  });

  it("keeps valid native server-tool pairs at the outbound boundary", async () => {
    const body = {
      model: "claude-sonnet-4-6",
      system: "native Claude fixture",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [{ type: "server_tool_use", id: "srvtoolu_native_1", name: "web_search", input: {} }],
        },
        {
          role: "user",
          content: [{
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_native_1",
            content: [{ type: "text", text: "native pair" }],
          }],
        },
      ],
    };

    const result = await handleChatCore({
      body,
      modelInfo: { provider: "claude", model: "claude-sonnet-4-6" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      connectionId: "valid-server-tool-native-route",
      clientRawRequest: {
        endpoint: "/v1/messages",
        body,
        headers: {
          "anthropic-version": "2023-06-01",
          "user-agent": "claude-cli/2.1.0",
          "x-9router-assistant-prefill": "preserve",
        },
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(mocks.execute, JSON.stringify(result)).toHaveBeenCalledOnce();
    const outbound = mocks.execute.mock.calls[0][0].body;
    expect(outbound.messages[0].content[0]).toMatchObject({ type: "server_tool_use", id: "srvtoolu_native_1" });
    expect(outbound.messages[1].content[0]).toMatchObject({ type: "web_search_tool_result", tool_use_id: "srvtoolu_native_1" });
  });
});
