import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  handleStreamingResponse: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute })),
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

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");


async function dispatch(provider, model, fields) {
  mocks.execute.mockClear();
  await handleChatCore({
    body: { model, stream: false, messages: [{ role: "user", content: "hello" }], ...fields },
    modelInfo: { provider, model }, credentials: { apiKey: "test", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() },
    connectionId: "test", clientRawRequest: { endpoint: "/v1/chat/completions", headers: { accept: "application/json" } },
  });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  return mocks.execute.mock.calls[0][0].body;
}

describe("OpenCode MiMo dispatch effort", () => {
  beforeEach(() => {
    mocks.handleNonStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.handleStreamingResponse.mockResolvedValue({ success: true });
    mocks.execute.mockResolvedValue({ response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }] }), { status: 200, headers: { "content-type": "application/json" } }), url: "https://example.invalid", headers: {} });
  });
  it.each([
    ["opencode-go", "mimo-v2.5"], ["opencode-go", "mimo-v2.5-pro"],
    ["opencode-zen", "mimo-v2.5-free"], ["opencode-zen", "mimo-v2.6-flash-free"],
    ["opencode", "mimo-v2.5-free"], ["opencode", "mimo-v2.6-flash-free"],
  ])("clamps the registered %s/%s route", async (provider, model) => {
    for (const [input, expected] of [["xhigh", "high"], ["max", "high"], ["ultra", "high"], ["minimal", "low"], ["none", "none"], ["low", "low"], ["medium", "medium"], ["high", "high"]]) {
      const body = await dispatch(provider, model, { reasoning_effort: input });
      expect(body.reasoning_effort).toBe(expected);
      expect(body.model).toBe(model);
      expect(body.messages[0].content).toBe("hello");
    }
  });
  it("preserves separate explicit carriers and their precedence", async () => {
    const body = await dispatch("opencode-go", "mimo-v2.5", { reasoning_effort: "minimal", reasoning: { effort: "max", summary: "auto" }, output_config: { effort: "ultra" } });
    expect(body.reasoning_effort).toBe("low");
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(body.output_config).toEqual({ effort: "high" });
  });
  it("normalizes a nested effort without inventing a different value", async () => {
    const body = await dispatch("opencode-go", "mimo-v2.5", { reasoning: { effort: "minimal" } });
    expect(body.reasoning.effort).toBe("low");
  });
  it.each([["opencode-go", "kimi-k2.6"], ["opencode-go", "mimo-v2.7"], ["ollama-cloud", "mimo-v2.5"], ["openai", "mimo-v2.5"]])("does not clamp unrelated %s/%s", async (provider, model) => {
    const body = await dispatch(provider, model, { reasoning_effort: "low" });
    expect(body.reasoning_effort).toBe(provider === "opencode-go" && model === "kimi-k2.6" ? "low" : "high");
  });
});
