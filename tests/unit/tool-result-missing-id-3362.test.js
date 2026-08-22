import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
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
vi.mock("open-sse/providers/shared.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ANTIGRAVITY_OAUTH_CLIENT: {},
  GOOGLE_OAUTH_CLIENT: {},
  CLAUDE_CLI_SPOOF_HEADERS: {},
}));
vi.mock("open-sse/providers/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  PROVIDER_OAUTH: {},
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  })),
}));
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()),
  handleStreamingResponse: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: mocks.handleNonStreamingResponse,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(),
}));
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function assistantCall(...ids) {
  return {
    role: "assistant",
    content: null,
    tool_calls: ids.map(id => ({
      id,
      type: "function",
      function: { name: "read_file", arguments: "{}" },
    })),
  };
}

async function dispatchThroughChatCore(messages, sourceFormat = FORMATS.OPENAI) {
  const isClaude = sourceFormat === FORMATS.CLAUDE;
  const provider = isClaude ? "claude" : "openai";
  const model = isClaude ? "claude-haiku-4-5" : "gpt-4o";
  const body = { model, ...(isClaude ? { max_tokens: 1024 } : {}), stream: false, messages };
  mocks.execute.mockResolvedValueOnce({
    response: new Response("{}", { status: 200 }),
    url: "https://upstream.test/v1/chat/completions",
    headers: {},
    transformedBody: {},
  });
  mocks.handleNonStreamingResponse.mockResolvedValueOnce({ success: true, response: new Response("{}") });

  await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: { apiKey: "test" },
    clientRawRequest: { endpoint: isClaude ? "/v1/messages" : "/v1/chat/completions", body, headers: { accept: "application/json" } },
    sourceFormatOverride: sourceFormat,
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    pxpipeEnabled: false,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  return mocks.execute.mock.calls.at(-1)[0].body;
}

describe("tool result ID recovery (decolua/9router#3369)", () => {
  it("claims parallel OpenAI tool-call IDs oldest-first", () => {
    const body = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", content: "first" },
        { role: "tool", content: "second" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages.slice(1).map(message => message.tool_call_id)).toEqual([
      "call_one",
      "call_two",
    ]);
  });

  it("is idempotent after missing results have claimed their calls", () => {
    const body = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", content: "first" },
        { role: "tool", content: "second" },
      ],
    };

    ensureToolCallIds(body);
    const afterFirstPass = structuredClone(body);
    ensureToolCallIds(body);
    ensureToolCallIds(body);

    expect(body).toEqual(afterFirstPass);
  });

  it("removes an explicit out-of-order OpenAI ID before assigning a missing ID", () => {
    const body = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", tool_call_id: "call_two", content: "second arrived first" },
        { role: "tool", content: "first arrived without its ID" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages.slice(1).map(message => message.tool_call_id)).toEqual([
      "call_two",
      "call_one",
    ]);
  });

  it("reserves a later explicit OpenAI ID before assigning an earlier missing result", () => {
    const body = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", content: "second arrived without its ID" },
        { role: "tool", tool_call_id: "call_one", content: "first arrived explicitly" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages.slice(1).map(message => message.tool_call_id)).toEqual([
      "call_two",
      "call_one",
    ]);
  });

  it("reserves only sanitized explicit IDs that match a pending call", () => {
    const matching = {
      messages: [
        assistantCall("call.one", "call_two"),
        { role: "tool", content: "missing" },
        { role: "tool", tool_call_id: "call.one", content: "explicit" },
      ],
    };
    const nonmatching = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", content: "missing" },
        { role: "tool", tool_call_id: "absent.id", content: "orphan explicit" },
      ],
    };

    ensureToolCallIds(matching);
    ensureToolCallIds(nonmatching);

    expect(matching.messages.slice(1).map(message => message.tool_call_id)).toEqual(["call_two", "callone"]);
    expect(nonmatching.messages.slice(1).map(message => message.tool_call_id)).toEqual(["call_one", "absentid"]);
  });

  it("claims Claude tool-use IDs for explicit and missing parallel results", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_one", name: "read_file", input: {} },
            { type: "tool_use", id: "call_two", name: "read_file", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_two", content: "second" },
            { type: "tool_result", content: "first" },
          ],
        },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[1].content.map(block => block.tool_use_id)).toEqual([
      "call_two",
      "call_one",
    ]);
  });

  it("reserves later explicit Claude IDs across several result blocks", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "cu_1", name: "read_file", input: {} },
            { type: "tool_use", id: "cu_2", name: "read_file", input: {} },
            { type: "tool_use", id: "cu_3", name: "read_file", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", content: "second arrived without its ID" },
            { type: "text", text: "between results" },
            { type: "tool_result", tool_use_id: "cu_1", content: "first arrived explicitly" },
            { type: "tool_result", content: "third arrived without its ID" },
          ],
        },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[1].content.filter(block => block.type === "tool_result").map(block => block.tool_use_id)).toEqual([
      "cu_2",
      "cu_1",
      "cu_3",
    ]);
  });

  it("keeps sanitization and uses deterministic fallback only for an orphan result", () => {
    const paired = {
      messages: [
        assistantCall("call.bad"),
        { role: "tool", tool_call_id: "call.bad", content: "done" },
      ],
    };
    const orphan = { messages: [{ role: "tool", content: "orphan" }] };

    ensureToolCallIds(paired);
    ensureToolCallIds(orphan);

    expect(paired.messages[0].tool_calls[0].id).toBe("callbad");
    expect(paired.messages[1].tool_call_id).toBe("callbad");
    expect(orphan.messages[0].tool_call_id).toBe("call_msg0_tc0");
  });

  it("does not reuse IDs left by an older assistant turn", () => {
    const body = {
      messages: [
        assistantCall("call_stale"),
        { role: "assistant", content: "new turn without a tool call" },
        { role: "tool", content: "orphan after the new turn" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[2].tool_call_id).toBe("call_msg2_tc0");
  });

  it("does not reserve explicit IDs beyond the next assistant boundary", () => {
    const body = {
      messages: [
        assistantCall("call_one", "call_two"),
        { role: "tool", content: "oldest missing result" },
        assistantCall("call_one"),
        { role: "tool", tool_call_id: "call_one", content: "new turn result" },
      ],
    };

    ensureToolCallIds(body);

    expect(body.messages[1].tool_call_id).toBe("call_one");
  });

  it("repairs a missing-first OpenAI run before production response repair", async () => {
    const outbound = await dispatchThroughChatCore([
      assistantCall("call_one", "call_two"),
      { role: "tool", content: "REAL second without its ID" },
      { role: "tool", tool_call_id: "call_one", content: "REAL first explicit" },
    ]);

    expect(outbound.messages).toHaveLength(3);
    expect(outbound.messages.slice(1)).toEqual([
      { role: "tool", tool_call_id: "call_two", content: "REAL second without its ID" },
      { role: "tool", tool_call_id: "call_one", content: "REAL first explicit" },
    ]);
    expect(JSON.stringify(outbound)).not.toContain("[No response received]");
    expect(JSON.stringify(outbound)).not.toContain("[Tool result:");
  });

  it("repairs a missing-first Claude run before production response repair", async () => {
    const outbound = await dispatchThroughChatCore([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "cu_1", name: "read_file", input: {} },
          { type: "tool_use", id: "cu_2", name: "read_file", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", content: "REAL Claude second without its ID" },
          { type: "tool_result", tool_use_id: "cu_1", content: "REAL Claude first explicit" },
        ],
      },
    ], FORMATS.CLAUDE);

    const results = outbound.messages.flatMap(message =>
      Array.isArray(message.content)
        ? message.content.filter(block => block.type === "tool_result")
        : []
    );
    expect(results).toEqual([
      { type: "tool_result", tool_use_id: "cu_1", content: "REAL Claude first explicit" },
      { type: "tool_result", tool_use_id: "cu_2", content: "REAL Claude second without its ID" },
    ]);
    expect(JSON.stringify(outbound)).not.toContain("[No response received]");
    expect(JSON.stringify(outbound)).not.toContain("[Tool result:");
  });

  it("keeps valid explicitly paired history byte-identical through production repair", async () => {
    const messages = [
      assistantCall("call_explicit_one", "call_explicit_two"),
      { role: "tool", tool_call_id: "call_explicit_one", content: "already paired first" },
      { role: "tool", tool_call_id: "call_explicit_two", content: "already paired second" },
    ];
    const expected = structuredClone(messages);

    const outbound = await dispatchThroughChatCore(messages);

    expect(JSON.stringify(outbound.messages)).toBe(JSON.stringify(expected));
  });

  it("retains stacked argument normalization from #3310", () => {
    const body = {
      messages: [{
        role: "assistant",
        tool_calls: [{
          id: "call_args",
          type: "function",
          function: { name: "read_file", arguments: null },
        }],
      }],
    };

    ensureToolCallIds(body);

    expect(body.messages[0].tool_calls[0].function.arguments).toBe("{}");
  });

  it("retains stacked Gemini terminal continuation from #3055", () => {
    const result = openaiToGeminiRequest("gemini-test", {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    }, false);

    expect(result.contents.at(-1)).toEqual({
      role: "user",
      parts: [{ text: "Continue" }],
    });
  });
});
