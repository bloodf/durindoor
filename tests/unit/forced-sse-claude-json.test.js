// Providers that force SSE on a Claude transport answer non-streaming requests
// with Anthropic SSE. The forced SSE→JSON path must parse those events instead of
// returning a 502.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { saveRequestDetail } = await import("@/lib/usageDb.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");
const { getModelTargetFormat } = await import("../../open-sse/config/providerModels.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

// Same wire shape as Kimi's endpoint: no space after `event:` / `data:`.
const sse = (events) => events.map((event) => `event:${event.type}\ndata:${JSON.stringify(event)}\n\n`).join("");

const messageStart = {
  type: "message_start",
  message: {
    id: "msg_kimi1", type: "message", role: "assistant", model: "kimi-for-coding", content: [],
    stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 0 },
  },
};
const end = (stopReason, outputTokens = 7) => [
  { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } },
  { type: "message_stop" },
];
const thinkingBlocks = [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me " } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "think" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } },
  { type: "content_block_stop", index: 0 },
];
const textBlock = (index, ...parts) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "" } },
  ...parts.map((text) => ({ type: "content_block_delta", index, delta: { type: "text_delta", text } })),
  { type: "content_block_stop", index },
];
const toolBlock = (index, id, name, ...parts) => [
  { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
  ...parts.map((partial_json) => ({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } })),
  { type: "content_block_stop", index },
];
const thinkingAndText = [messageStart, { type: "ping" }, ...thinkingBlocks, ...textBlock(1, "Hel", "lo"), ...end("end_turn")];
const withTool = [messageStart, ...thinkingBlocks, ...textBlock(1, "Reading"), ...toolBlock(2, "toolu_1", "alias_read", "{\"pa", "th\":\"/a\"}"), ...end("tool_use")];

function run(raw, overrides = {}) {
  const context = {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.CLAUDE,
    provider: "kimi-coding-apikey",
    model: "kimi-for-coding",
    body: { model: "kimi-for-coding", stream: false },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/messages" },
    onRequestSuccess: vi.fn(async () => {}),
    onEmptyStream: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "event-test",
    terminalProvenance: "upstream",
    ...overrides,
  };
  return handleForcedSSEToJson(context).then((result) => ({ result, context }));
}
const chat = { sourceFormat: FORMATS.OPENAI, clientRawRequest: { endpoint: "/v1/chat/completions" } };

describe("forced SSE to JSON with an Anthropic upstream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("covers every provider that forces SSE on a Claude transport", () => {
    for (const id of ["kimi-coding", "kimi-coding-apikey"]) {
      expect(PROVIDERS[id].forceStream, id).toBe(true);
      expect(PROVIDERS[id].format, id).toBe(FORMATS.CLAUDE);
    }
    expect(PROVIDERS.opencode.forceStream).toBe(true);
    expect(getModelTargetFormat("oc", "union-alpha")).toBe(FORMATS.CLAUDE);
  });

  it("gives Claude clients the native message with signed thinking, stop_reason and cache usage", async () => {
    const { result, context } = await run(sse(thinkingAndText));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body).toMatchObject({ id: "msg_kimi1", type: "message", role: "assistant", stop_reason: "end_turn", stop_sequence: null });
    expect(body.content).toEqual([
      { type: "thinking", thinking: "let me think", signature: "sig-abc" },
      { type: "text", text: "Hello" },
    ]);
    expect(body.usage).toEqual({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 7 });
    expect(context.onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("gives Claude clients tool_use blocks in stream order with parsed input and restored names", async () => {
    const { result } = await run(sse(withTool), { toolNameMap: new Map([["alias_read", "Read"]]) });
    const body = await result.response.json();
    expect(body.stop_reason).toBe("tool_use");
    expect(body.content.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
    expect(body.content[2]).toEqual({ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } });
  });

  it("keeps redacted thinking and non-tool stop reasons for Claude clients", async () => {
    const { result } = await run(sse([
      messageStart,
      { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "opaque" } },
      { type: "content_block_stop", index: 0 },
      ...textBlock(1, "partial"),
      { type: "message_delta", delta: { stop_reason: "stop_sequence", stop_sequence: "END" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]));
    const body = await result.response.json();
    expect(body.content[0]).toEqual({ type: "redacted_thinking", data: "opaque" });
    expect(body).toMatchObject({ stop_reason: "stop_sequence", stop_sequence: "END" });
  });

  it("strips thinking for classifier-compat Claude requests", async () => {
    const { result } = await run(sse(thinkingAndText), { claudeClassifierCompat: "always" });
    const body = await result.response.json();
    expect(body.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  const clients = [["Claude", {}], ["Chat", chat]];
  const partialTool = (stopReason) => [messageStart, ...textBlock(0, "Reading"), ...toolBlock(1, "toolu_1", "Read", "{\"path\":"), ...end(stopReason)];

  it("drops an incomplete tool block for Claude clients on max_tokens", async () => {
    const { result, context } = await run(sse(partialTool("max_tokens")));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.stop_reason).toBe("max_tokens");
    expect(body.content).toEqual([{ type: "text", text: "Reading" }]);
    expect(context.onRequestSuccess).toHaveBeenCalledOnce();
    expect(context.onEmptyStream).not.toHaveBeenCalled();
  });

  it("drops an incomplete tool block for Chat clients on max_tokens", async () => {
    const { result, context } = await run(sse(partialTool("max_tokens")), chat);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].finish_reason).toBe("length");
    expect(body.choices[0].message.content).toBe("Reading");
    expect(body.choices[0].message.tool_calls).toBeUndefined();
    expect(context.onRequestSuccess).toHaveBeenCalledOnce();
  });

  it("keeps a complete tool block next to a dropped one on max_tokens", async () => {
    const events = [messageStart, ...toolBlock(0, "toolu_1", "Read", "{\"path\":\"/a\"}"), ...toolBlock(1, "toolu_2", "Read", "{\"pa"), ...end("max_tokens")];
    const claude = await (await run(sse(events))).result.response.json();
    expect(claude.content).toEqual([{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } }]);
    const openai = await (await run(sse(events), chat)).result.response.json();
    expect(openai.choices[0].message.tool_calls.map((call) => call.id)).toEqual(["toolu_1"]);
  });

  it.each(clients.flatMap(([label, overrides]) => ["tool_use", "end_turn"].map((stopReason) => [label, stopReason, overrides])))(
    "rejects unparseable tool input for %s clients on %s", async (_label, stopReason, overrides) => {
      const { result, context } = await run(sse(partialTool(stopReason)), overrides);
      expect(result.success).toBe(false);
      expect(result.status).toBe(502);
      expect(saveRequestDetail).not.toHaveBeenCalled();
      expect(context.onRequestSuccess).not.toHaveBeenCalled();
    });

  it.each(clients)("rejects a bare message_stop for %s clients", async (_label, overrides) => {
    const { result, context } = await run(sse([{ type: "message_stop" }]), overrides);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(context.onRequestSuccess).not.toHaveBeenCalled();
    expect(context.onEmptyStream).not.toHaveBeenCalled();
  });

  it("reports empty output for Claude clients the way the streaming path does", async () => {
    const { result, context } = await run(sse([messageStart, { type: "message_stop" }]));
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.id).toBe("msg_kimi1");
    expect(body.content).toEqual([{ type: "text", text: "" }]);
    expect(context.onRequestSuccess).toHaveBeenCalledOnce();
    expect(context.onEmptyStream).toHaveBeenCalledOnce();
  });

  it("reports empty output for Chat clients despite the synthetic whitespace", async () => {
    const { result, context } = await run(sse([messageStart, { type: "message_stop" }]), chat);
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe(" ");
    expect(context.onEmptyStream).toHaveBeenCalledOnce();
  });

  it("survives a failing empty-output callback", async () => {
    const { result } = await run(sse([messageStart, { type: "message_stop" }]), {
      onEmptyStream: vi.fn(async () => { throw new Error("db down"); }),
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["a refusal", [messageStart, ...end("refusal", 0)]],
    ["a tool-only turn", [messageStart, ...toolBlock(0, "toolu_1", "Read", "{}"), ...end("tool_use", 0)]],
    ["a thinking-only turn", [messageStart, ...thinkingBlocks, ...end("end_turn", 0)]],
    ["text", [messageStart, ...textBlock(0, "Hi"), ...end("end_turn", 0)]],
    ["output tokens alone", [messageStart, ...end("end_turn", 3)]],
  ])("does not report empty output for %s", async (_label, events) => {
    const { result, context } = await run(sse(events));
    expect(result.success).toBe(true);
    expect(context.onEmptyStream).not.toHaveBeenCalled();
  });

  it("falls back to projected usage when the upstream sends none", async () => {
    const { usage: _usage, ...noUsage } = messageStart.message;
    const { result } = await run(sse([
      { type: "message_start", message: noUsage },
      ...textBlock(0, "Hi"),
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]));
    const { usage } = await result.response.json();
    expect(usage).toMatchObject({ input_tokens: 0, output_tokens: 0 });
  });

  it.each(clients.flatMap(([label, overrides]) => [["a string", "0"], ["a missing", undefined]].map(([kind, index]) => [label, kind, index, overrides])))(
    "rejects %s client streams with %s block index", async (_label, _kind, index, overrides) => {
      const { result, context } = await run(sse([
        messageStart,
        { type: "content_block_start", index, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index, delta: { type: "text_delta", text: "Hi" } },
        { type: "content_block_stop", index },
        ...end("end_turn"),
      ]), overrides);
      expect(result.status).toBe(502);
      expect(context.onRequestSuccess).not.toHaveBeenCalled();
    });

  it.each(clients)("parses CRLF line endings for %s clients", async (label, overrides) => {
    const raw = thinkingAndText.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join("");
    const { result } = await run(raw, overrides);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    if (label === "Claude") expect(body.content[1].text).toBe("Hello");
    else expect(body.choices[0].message.content).toBe("Hello");
  });

  const interleaved = (() => {
    const [startA, deltaA1, deltaA2, stopA] = toolBlock(0, "toolu_a", "Read", "{\"a\":", "1}");
    const [startB, deltaB1, deltaB2, stopB] = toolBlock(1, "toolu_b", "Write", "{\"b\":", "2}");
    return [messageStart, startA, startB, deltaB1, deltaA1, deltaA2, deltaB2, stopB, stopA, ...end("tool_use")];
  })();

  it("keeps interleaved tool blocks apart for Claude clients", async () => {
    const { result } = await run(sse(interleaved));
    const body = await result.response.json();
    expect(body.content).toEqual([
      { type: "tool_use", id: "toolu_a", name: "Read", input: { a: 1 } },
      { type: "tool_use", id: "toolu_b", name: "Write", input: { b: 2 } },
    ]);
  });

  it("keeps interleaved tool blocks apart for Chat clients", async () => {
    const { result } = await run(sse(interleaved), chat);
    const body = await result.response.json();
    expect(body.choices[0].message.tool_calls).toEqual([
      { id: "toolu_a", type: "function", function: { name: "Read", arguments: "{\"a\":1}" } },
      { id: "toolu_b", type: "function", function: { name: "Write", arguments: "{\"b\":2}" } },
    ]);
  });

  it("gives Chat clients reasoning_content, finish_reason and cache-inclusive usage", async () => {
    const { result } = await run(sse(thinkingAndText), chat);
    const body = await result.response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message).toMatchObject({ role: "assistant", content: "Hello", reasoning_content: "let me think" });
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage).toMatchObject({ prompt_tokens: 105, completion_tokens: 7, total_tokens: 112 });
  });

  it("gives Chat clients whole tool_calls with restored names", async () => {
    const { result } = await run(sse(withTool), { ...chat, toolNameMap: new Map([["alias_read", "Read"]]) });
    const body = await result.response.json();
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls).toEqual([
      { id: "toolu_1", type: "function", function: { name: "Read", arguments: "{\"path\":\"/a\"}" } },
    ]);
  });

  it.each([["Claude", {}], ["Chat", chat]])("saves request details for %s clients", async (_label, overrides) => {
    await run(sse(thinkingAndText), overrides);
    expect(saveRequestDetail).toHaveBeenCalledOnce();
    const detail = saveRequestDetail.mock.calls[0][0];
    expect(detail.status).toBe("success");
    expect(detail.response).toMatchObject({ content: "Hello", thinking: "let me think", finish_reason: "stop" });
    expect(detail.tokens).toMatchObject({ prompt_tokens: 105, completion_tokens: 7 });
  });

  it.each([["Claude", {}], ["Chat", chat]])("keeps a %s stream without message_stop a 502", async (_label, overrides) => {
    const truncated = thinkingAndText.filter((event) => event.type !== "message_stop");
    const { result, context } = await run(sse(truncated), overrides);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(saveRequestDetail).not.toHaveBeenCalled();
    expect(context.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([["Claude", {}], ["Chat", chat]])("surfaces an Anthropic error event to %s clients", async (_label, overrides) => {
    const { result, context } = await run(sse([
      messageStart,
      ...textBlock(0, "partial"),
      { type: "error", error: { type: "overloaded_error", message: "Upstream is overloaded" } },
    ]), overrides);
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("Upstream is overloaded");
    expect(result.quotaTerminalReason).toBe("stream_error");
    expect(saveRequestDetail).not.toHaveBeenCalled();
    expect(context.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects an error event even after message_stop", async () => {
    const { result } = await run(sse([...thinkingAndText, { type: "error", error: { message: "late" } }]));
    expect(result.success).toBe(false);
  });

  it("accepts the same stream with spaces after the colons", async () => {
    const raw = thinkingAndText.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const { result } = await run(raw);
    expect(result.success).toBe(true);
    expect((await result.response.json()).content[1].text).toBe("Hello");
  });
});
