import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { buildOnStreamComplete, handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");
const { peekStreamForContent } = await import("../../open-sse/utils/streamContentPeek.js");

const { handleComboChat } = await import("../../open-sse/services/combo.js");

const model = "test-model";
const openAIUsage = (count) => ({ prompt_tokens: 7, completion_tokens: count, total_tokens: 7 + count });
const claudeUsage = (count) => ({ input_tokens: 7, output_tokens: count, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 });

function openAICompletion(reason, count) {
  return {
    id: "chatcmpl-test", object: "chat.completion", model,
    choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: reason }],
    usage: openAIUsage(count)
  };
}

function claudeCompletion(reason, count) {
  return {
    id: "msg_test", type: "message", role: "assistant", model, content: [],
    stop_reason: reason, stop_sequence: null, usage: claudeUsage(count)
  };
}

const data = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const done = "data: [DONE]\n\n";
const openAIFrame = (reason, count) => ({
  id: "chatcmpl-test", object: "chat.completion.chunk", created: 123, model,
  choices: [{ index: 0, delta: { content: "" }, finish_reason: reason }],
  usage: openAIUsage(count)
});

function claudeFrames(reason, count) {
  return [
    { type: "message_start", message: claudeCompletion(null, 0) },
    { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: count } },
    { type: "message_stop" }
  ].map((event) => `event: ${event.type}\n${data(event)}`);
}

const sse = (wire) => new Response(wire, { headers: { "content-type": "text/event-stream" } });

function options(format, providerResponse) {
  return {
    providerResponse, provider: format === FORMATS.CLAUDE ? "anthropic" : "openai", model,
    sourceFormat: format, targetFormat: format, body: { model, messages: [] },
    stream: false, streamToClient: false, requestStartTime: Date.now(), connectionId: "connection-test",
    clientRawRequest: { endpoint: format === FORMATS.CLAUDE ? "/v1/messages" : "/v1/chat/completions" },
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
    trackDone: vi.fn(), appendLog: vi.fn(), log: { warn: vi.fn(), line: vi.fn() },
    terminalProvenance: "upstream", onRequestSuccess: vi.fn(), onEmptyStream: vi.fn()
  };
}

async function stream(format, wire, sourceFormat = format) {
  const context = { ...options(format, sse(wire)), sourceFormat, stream: true, streamToClient: true };
  const completion = buildOnStreamComplete(context);
  const result = await handleStreamingResponse({
    ...context, ...completion,
    streamController: createStreamController({ provider: context.provider, model })
  });
  expect(result.success).toBe(true);
  return { response: result.response, onEmptyStream: context.onEmptyStream };
}

describe("token-limit completions with empty visible output", () => {
  it.each([0, 4])("keeps both JSON completions and their usage with %i output tokens", async (count) => {
    for (const [format, payload] of [
      [FORMATS.OPENAI, openAICompletion("length", count)],
      [FORMATS.CLAUDE, claudeCompletion("max_tokens", count)]
    ]) {
      const context = options(format, Response.json(payload));
      const result = await handleNonStreamingResponse(context);
      expect(result.success).toBe(true);
      expect(result.response.status).toBe(200);
      const usage = format === FORMATS.OPENAI ?
        { ...payload.usage, prompt_tokens: 2007, total_tokens: 2007 + count } : payload.usage;
      expect(await result.response.json()).toMatchObject({ ...payload, usage });
      expect(context.onRequestSuccess).toHaveBeenCalledOnce();
    }
  });

  it.each([0, 4])("keeps an OpenAI length stream with %i output tokens through both peeks", async (count) => {
    const frame = openAIFrame("length", count);
    const { response, onEmptyStream } = await stream(FORMATS.OPENAI, data(frame) + done);
    const first = await peekStreamForContent(response);
    expect(first.hasContent).toBe(true);
    const second = await peekStreamForContent(sse(first.body));
    expect(second.hasContent).toBe(true);
    const output = await new Response(second.body).text();
    const emitted = JSON.parse(output.split("\n")[0].slice(6));
    expect(emitted).toMatchObject({
      ...frame, usage: { ...frame.usage, prompt_tokens: 2007, total_tokens: 2007 + count }
    });
    expect(output).toContain(done);
    expect(output).not.toContain("error");
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it.each([0, 4])("keeps a Claude max_tokens stream with %i output tokens", async (count) => {
    const wire = claudeFrames("max_tokens", count).join("");
    const { response, onEmptyStream } = await stream(FORMATS.CLAUDE, wire);
    const peek = await peekStreamForContent(response);
    expect(peek.hasContent).toBe(true);
    expect(await new Response(peek.body).text()).toBe(wire);
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it("keeps Claude max_tokens when translating to OpenAI and when buffering to JSON", async () => {
    const wire = claudeFrames("max_tokens", 0).join("");
    const { response, onEmptyStream } = await stream(FORMATS.CLAUDE, wire, FORMATS.OPENAI);
    const peek = await peekStreamForContent(response);
    expect(peek.hasContent).toBe(true);
    const output = await new Response(peek.body).text();
    expect(output).toContain('"finish_reason":"length"');
    expect(output).not.toContain("error");
    expect(onEmptyStream).not.toHaveBeenCalled();

    const context = { ...options(FORMATS.CLAUDE, sse(wire)), stream: true };
    const result = await handleForcedSSEToJson(context);
    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject({
      ...claudeCompletion("max_tokens", 0), content: [{ type: "text", text: "" }]
    });
    expect(context.onEmptyStream).not.toHaveBeenCalled();
  });

  it.each([
    ["length", 1],
    ["stop", 2]
  ])("makes %s JSON take the expected number of combo attempts", async (reason, attempts) => {
    const payload = openAICompletion(reason, 0);
    const handleSingleModel = vi.fn()
      .mockImplementationOnce(async () => Response.json(payload))
      .mockImplementationOnce(async () => Response.json({ text: "retry answer" }));
    const response = await handleComboChat({
      body: { stream: false }, models: ["openai/test-model", "openai/second-test-model"],
      handleSingleModel, comboName: "token-limit-test", comboStrategy: "fallback",
      log: { info() {}, warn() {}, error() {}, debug() {} }
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(attempts);
    expect(await response.json()).toEqual(attempts === 1 ? payload : { text: "retry answer" });
  });

  it.each([
    [FORMATS.OPENAI, openAICompletion("stop", 4)],
    [FORMATS.OPENAI, openAICompletion(null, 4)],
    [FORMATS.OPENAI, openAICompletion("Length", 4)],
    [FORMATS.CLAUDE, claudeCompletion("end_turn", 4)],
    [FORMATS.CLAUDE, claudeCompletion(null, 4)],
    [FORMATS.CLAUDE, { ...claudeCompletion("max_tokens", 4), content: null }],
    [FORMATS.CLAUDE, claudeCompletion("MAX_TOKENS", 4)]
  ])("keeps an empty or malformed %s JSON completion retryable", async (format, payload) => {
    const context = options(format, Response.json(payload));
    expect(await handleNonStreamingResponse(context)).toMatchObject({ success: false, status: 502 });
    expect(context.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([
    [FORMATS.OPENAI, data(openAIFrame("stop", 0)) + done],
    [FORMATS.CLAUDE, claudeFrames("end_turn", 0).join("")]
  ])("keeps true-empty %s streams eligible for failover", async (format, wire) => {
    const { response, onEmptyStream } = await stream(format, wire);
    const peek = await peekStreamForContent(response);
    expect(peek.hasContent).toBe(false);
    expect(await new Response(peek.body).text()).toContain("Provider returned empty content");
    expect(onEmptyStream).toHaveBeenCalledOnce();
  });

  it.each([
    [FORMATS.OPENAI, data(openAIFrame("length", 0))],
    [FORMATS.OPENAI, data(openAIFrame(null, 0)) + done],
    [FORMATS.OPENAI, data(openAIFrame("max_tokens", 0)) + done],
    [FORMATS.OPENAI, data({ ...openAIFrame("length", 0), choices: [{ index: 0, finish_reason: "length" }] }) + done],
    [FORMATS.CLAUDE, claudeFrames("MAX_TOKENS", 0).join("")],
    [FORMATS.CLAUDE, claudeFrames("max_tokens", 0).slice(0, -1).join("")]
  ])("does not treat a missing or malformed %s terminal as token-limited", async (format, wire) => {
    const { response } = await stream(format, wire);
    const peek = await peekStreamForContent(response);
    expect(peek.hasContent).toBe(false);
    await peek.body.cancel();
  });
});
