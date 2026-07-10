// Guards handleNonStreamingResponse's synthetic SSE fallback (forced non-streaming
// providers whose client asked for streaming). Previously always emitted raw OpenAI
// chat.completion.chunk frames regardless of client format, breaking non-OpenAI
// clients (e.g. Claude Messages API streaming) whose SSE parsers expect
// `event: content_block_delta` etc. See review PRRT_kwDOTM9Pps6OxECd.
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function makeProviderResponse(body) {
  const clone = JSON.parse(JSON.stringify(body));
  return {
    headers: new Map([["content-type", "application/json"]]),
    text: () => Promise.resolve(JSON.stringify(clone)),
    json: () => Promise.resolve(clone),
    status: 200,
    statusText: "OK",
  };
}

function baseOptions(overrides) {
  return {
    provider: "galadriel",
    model: "galadriel-latest",
    body: { model: "galadriel-latest", messages: [] },
    stream: false,
    streamToClient: true,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    ...overrides,
  };
}

describe("handleNonStreamingResponse: synthetic SSE respects client format", () => {
  const openaiCompletion = {
    id: "chatcmpl-abc",
    object: "chat.completion",
    created: 123,
    model: "galadriel-latest",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };

  it("emits OpenAI chat.completion.chunk SSE frames for an OpenAI client", async () => {
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(openaiCompletion),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
    }));
    const text = await result.response.text();

    expect(text).toContain("data: ");
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("\"content\":\"hello\"");
    expect(text).toContain("data: [DONE]");
  });

  it("emits Claude-format SSE events (not raw OpenAI chunks) for a Claude client", async () => {
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(openaiCompletion),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
    }));
    const text = await result.response.text();

    // Claude SSE frames are named events, never raw chat.completion.chunk objects.
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");
    expect(text).not.toContain("chat.completion.chunk");
    expect(text).toContain("hello");
  });

  it("preserves OpenAI usage in synthesized Claude message_delta", async () => {
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(openaiCompletion),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
    }));
    const text = await result.response.text();

    const messageDelta = text.split("\n\n")
      .map(frame => frame.replace(/^event: message_delta\ndata: /, ""))
      .find(line => line.startsWith("{"));
    expect(messageDelta).toBeDefined();
    const parsed = JSON.parse(messageDelta);
    expect(parsed.delta).toBeDefined();
    expect(parsed.usage).toEqual({ input_tokens: 2, output_tokens: 3 });
  });

  it("omits OpenAI-style [DONE] sentinel for Claude clients", async () => {
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(openaiCompletion),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
    }));
    const text = await result.response.text();

    expect(text).toContain("event: message_stop");
    expect(text).not.toContain("data: [DONE]");
  });

  it("omits OpenAI-style [DONE] sentinel for Gemini-family clients", async () => {
    const geminiFamily = [FORMATS.GEMINI, FORMATS.ANTIGRAVITY, FORMATS.GEMINI_CLI, FORMATS.VERTEX];
    for (const sourceFormat of geminiFamily) {
      const result = await handleNonStreamingResponse(baseOptions({
        providerResponse: makeProviderResponse(openaiCompletion),
        sourceFormat,
        targetFormat: FORMATS.OPENAI,
      }));
      const text = await result.response.text();
      expect(text, `${sourceFormat} should not emit OpenAI [DONE]`).not.toContain("data: [DONE]");
    }
  });

  it("preserves native Gemini-family candidates, inline data, and metadata", async () => {
    const native = {
      candidates: [{
        content: {
          role: "model",
          parts: [
            { text: "native answer" },
            { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } },
          ],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
    };
    for (const sourceFormat of [FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX]) {
      const result = await handleNonStreamingResponse(baseOptions({
        providerResponse: makeProviderResponse(native),
        sourceFormat,
        targetFormat: sourceFormat,
      }));
      const text = await result.response.text();
      expect(text).toContain("native answer");
      expect(text).toContain("inlineData");
      expect(text).toContain("JVBERi0=");
      expect(text).toContain("usageMetadata");
      expect(text).not.toContain("chat.completion.chunk");
      expect(text).not.toContain("data: [DONE]");
    }

    const wrapped = { response: native };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(wrapped),
      sourceFormat: FORMATS.ANTIGRAVITY,
      targetFormat: FORMATS.ANTIGRAVITY,
    }));
    const text = await result.response.text();
    expect(text).toContain("native answer");
    expect(text).toContain("inlineData");
    expect(text).not.toContain("chat.completion.chunk");
  });

  it("preserves reasoning content when synthesizing Claude SSE", async () => {
    const reasoningCompletion = {
      ...openaiCompletion,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          reasoning_content: "I think therefore I am",
          content: "therefore I am",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(reasoningCompletion),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
    }));
    const text = await result.response.text();

    expect(text).toContain("event: content_block_start");
    expect(text).toContain("thinking_delta");
    expect(text).toContain("I think therefore I am");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("therefore I am");
  });

  it("extracts <think> reasoning into reasoning_content for OpenAI non-streaming clients", async () => {
    const thinkCompletion = {
      ...openaiCompletion,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "<think>planning step</think>visible answer",
        },
        finish_reason: "stop",
      }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(thinkCompletion),
      provider: "minimax-cn",
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [] },
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamToClient: false,
    }));
    const body = await result.response.json();
    const msg = body.choices[0].message;
    expect(msg.reasoning_content).toBe("planning step");
    expect(msg.content).toBe("visible answer");
  });

  it("extracts before OpenAI-to-Claude projection", async () => {
    const thinkCompletion = {
      ...openaiCompletion,
      model: "MiniMax-M3",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "<think>planning step</think>visible answer" },
        finish_reason: "stop",
      }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(thinkCompletion),
      provider: "minimax-cn",
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [] },
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      streamToClient: false,
    }));
    const body = await result.response.json();
    expect(body.type).toBe("message");
    expect(body.content).toEqual([
      { type: "text", text: "visible answer" },
      { type: "thinking", thinking: "planning step" },
    ]);
  });

  it("synthesizes extracted reasoning into SSE exactly once", async () => {
    const thinkCompletion = {
      ...openaiCompletion,
      model: "MiniMax-M3",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "<think>once only</think>visible answer" },
        finish_reason: "stop",
      }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(thinkCompletion),
      provider: "minimax",
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [] },
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamToClient: true,
    }));
    const text = await result.response.text();
    expect(text.match(/once only/g)).toHaveLength(1);
    expect(text).toContain('"reasoning_content":"once only"');
    expect(text).toContain('"content":"visible answer"');
    expect(text).not.toContain("<think>");
  });

  it("preserves every MiniMax choice when synthesizing OpenAI SSE", async () => {
    const multiChoice = {
      ...openaiCompletion,
      model: "MiniMax-M3",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "<think>zero reason</think>zero answer" },
          finish_reason: "stop",
        },
        {
          index: 1,
          message: { role: "assistant", content: "<think>one reason</think>one answer" },
          finish_reason: "length",
        },
      ],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(multiChoice),
      provider: "minimax",
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [] },
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamToClient: true,
    }));
    const objects = (await result.response.text()).split("\n")
      .filter(line => line.startsWith("data:") && line.slice(5).trim() !== "[DONE]")
      .map(line => JSON.parse(line.slice(5).trim()));
    const collect = (index, field) => objects
      .flatMap(object => object.choices || [])
      .filter(choice => choice.index === index)
      .map(choice => choice.delta?.[field] || "")
      .join("");

    expect(collect(0, "reasoning_content")).toBe("zero reason");
    expect(collect(0, "content")).toBe("zero answer");
    expect(collect(1, "reasoning_content")).toBe("one reason");
    expect(collect(1, "content")).toBe("one answer");
    const terminal = objects.find(object => object.choices?.some(choice => choice.finish_reason));
    expect(terminal.choices).toMatchObject([
      { index: 0, finish_reason: "stop" },
      { index: 1, finish_reason: "length" },
    ]);
  });

  it("leaves literal tags visible for providers without the response quirk", async () => {
    const literalCompletion = {
      ...openaiCompletion,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "<think>visible literal</think>answer" },
        finish_reason: "stop",
      }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(literalCompletion),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamToClient: false,
    }));
    const message = (await result.response.json()).choices[0].message;
    expect(message.content).toBe("<think>visible literal</think>answer");
    expect(message.reasoning_content).toBeUndefined();
  });

  it("preserves native structured reasoning for configured M3 responses", async () => {
    const nativeCompletion = {
      ...openaiCompletion,
      model: "MiniMax-M3",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "visible answer", reasoning_content: "native reasoning" },
        finish_reason: "stop",
      }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(nativeCompletion),
      provider: "minimax",
      model: "MiniMax-M3",
      body: { model: "MiniMax-M3", messages: [] },
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamToClient: false,
    }));
    const message = (await result.response.json()).choices[0].message;
    expect(message).toEqual({ role: "assistant", content: "visible answer", reasoning_content: "native reasoning" });
  });

  it("still returns the client-shaped Claude JSON body (not SSE) for a real non-streaming request", async () => {
    // streamToClient:false — same sourceFormat/targetFormat as the SSE test
    // above, but the client actually asked for JSON. Guards that forcing the
    // OpenAI-normalized intermediate for SSE synthesis didn't leak into the
    // ordinary non-streaming Claude-client path (which must still return the
    // translated Claude message shape, not the OpenAI intermediate).
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(openaiCompletion),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      streamToClient: false,
    }));
    expect(result.response.headers.get("Content-Type")).toBe("application/json");
    const body = await result.response.json();
    expect(body.type).toBe("message");
    expect(body.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("normalizes Claude usage and tool terminal semantics for an OpenAI stream", async () => {
    const claudeCompletion = {
      id: "msg-claude",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [
        { type: "thinking", thinking: "considering" },
        { type: "text", text: "calling tool" },
        { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 7 },
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(claudeCompletion),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.CLAUDE,
    }));
    const text = await result.response.text();

    expect(text).toContain("considering");
    expect(text).toContain("calling tool");
    expect(text).toContain('"name":"lookup"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain('"prompt_tokens":5');
    expect(text).toContain('"completion_tokens":7');
    expect(text).not.toContain('"input_tokens":5');
    expect(text).toContain("data: [DONE]");
  });
});
