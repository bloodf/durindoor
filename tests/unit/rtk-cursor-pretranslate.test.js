import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// Cursor's translator (openai-to-cursor.js) rewrites role:"tool" / Claude
// tool_result blocks into plain `<tool_result>` user text before RTK's normal
// post-translate pass ever runs, so that pass finds no tool-result shape to
// compress. RTK must run on the cursor request's SOURCE body, before that
// rewrite, same as headroom already does for every provider (#2698).

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

function makeLongDiff() {
  const lines = ["diff --git a/foo.js b/foo.js", "index abc..def 100644", "--- a/foo.js", "+++ b/foo.js", "@@ -1,3 +1,200 @@"];
  for (let i = 0; i < 200; i++) lines.push(`+added line ${i} UNIQUE_PADDING_${i} ${"x".repeat(20)}`);
  return lines.join("\n");
}

describe("RTK on Cursor runs before translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleNonStreamingResponse.mockImplementation(async ({ providerResponse }) => ({ success: true, response: providerResponse }));
    mocks.execute.mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://api2.cursor.sh/agent",
      headers: {},
      transformedBody: null,
    });
  });

  it("compresses a role:tool git diff before openai→cursor rewrites it into <tool_result> text", async () => {
    const diff = makeLongDiff();
    const body = {
      model: "cu/default",
      stream: false,
      messages: [
        { role: "system", content: "hi" },
        { role: "user", content: "run git diff" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: JSON.stringify({ command: "git diff" }) } }],
        },
        { role: "tool", tool_call_id: "call_1", content: diff },
        { role: "user", content: "summarize" },
      ],
    };

    await handleChatCore({
      body,
      modelInfo: { provider: "cursor", model: "default" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() },
      connectionId: "test-conn",
      rtkEnabled: true,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: { model: "cu/default" },
        headers: { accept: "application/json" },
      },
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const dispatchedBody = mocks.execute.mock.calls[0][0].body;
    const blob = JSON.stringify(dispatchedBody.messages);

    // openai-to-cursor.js folds the tool result into a user-role
    // `<tool_result>` XML block.
    expect(blob).toContain("<tool_result>");
    // RTK compressed the diff before that fold, so the huge padded diff
    // never reached the translator at full size.
    expect(blob).toContain("lines truncated");
    expect(blob).not.toContain("UNIQUE_PADDING_150");
  });
});
