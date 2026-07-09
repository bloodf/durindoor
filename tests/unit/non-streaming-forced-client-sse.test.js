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

  it("preserves tool calls when synthesizing Claude SSE", async () => {
    const toolCompletion = {
      ...openaiCompletion,
      choices: [{
        index: 0,
        message: { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] },
        finish_reason: "tool_calls",
      }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(toolCompletion),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
    }));
    const text = await result.response.text();

    expect(text).toContain("\"type\":\"tool_use\"");
    expect(text).toContain("\"name\":\"lookup\"");
  });

  it("preserves native Gemini parts when synthesizing Gemini SSE", async () => {
    const geminiResponse = {
      responseId: "gemini-1",
      candidates: [{ content: { role: "model", parts: [
        { text: "caption" },
        { inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } },
      ] }, finishReason: "STOP" }],
    };
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: makeProviderResponse(geminiResponse),
      sourceFormat: FORMATS.GEMINI,
      targetFormat: FORMATS.GEMINI,
    }));
    const text = await result.response.text();

    expect(text).toContain("caption");
    expect(text).toContain("aW1hZ2U=");
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
});
