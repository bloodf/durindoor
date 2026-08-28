import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

const { EMPTY_CONTENT_COOLDOWN_MS } = await import("../../open-sse/config/errorConfig.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse, translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { buildOnStreamComplete, handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

function options(responseBody, overrides = {}) {
  return {
    providerResponse: Response.json(responseBody), provider: "openai", model: "gpt-test",
    sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    body: { model: "gpt-test", messages: [] }, stream: false, streamToClient: false,
    requestStartTime: Date.now(), connectionId: "connection-test",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
    trackDone: vi.fn(), appendLog: vi.fn(), log: { warn: vi.fn(), line: vi.fn() },
    ...overrides
  };
}

describe("non-stream empty-content fallback (#3465)", () => {
  it("returns a cooldown-bearing 502 for null OpenAI content and records billed input", async () => {
    const startedAt = Date.now();
    const request = options({
      choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 }
    });
    const result = await handleNonStreamingResponse(request);

    expect(result).toMatchObject({ success: false, status: 502, error: "Empty response content from openai/gpt-test" });
    expect(result.resetsAtMs).toBeGreaterThanOrEqual(startedAt + EMPTY_CONTENT_COOLDOWN_MS);
    expect(result.resetsAtMs).toBeLessThanOrEqual(Date.now() + EMPTY_CONTENT_COOLDOWN_MS);
    expect(request.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({ prompt_tokens: 7, completion_tokens: 0 })
    }));
  });

  it("keeps reasoning-only and tool-call-only completions usable", async () => {
    for (const message of [
      { role: "assistant", content: null, reasoning_content: "thinking" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "run", arguments: "{}" } }] }
    ]) {
      const result = await handleNonStreamingResponse(options({ choices: [{ message, finish_reason: "stop" }] }));
      expect(result.success).toBe(true);
    }
  });

  it.each([
    FORMATS.GEMINI,
    FORMATS.ANTIGRAVITY,
    FORMATS.GEMINI_CLI,
    FORMATS.VERTEX,
    FORMATS.OLLAMA
  ])("accepts emitted OpenAI content for a %s client", async (sourceFormat) => {
    const result = await handleNonStreamingResponse(options({
      choices: [{ message: { role: "assistant", content: "translated answer" }, finish_reason: "stop" }]
    }, { sourceFormat, targetFormat: FORMATS.OPENAI }));

    expect(result.success).toBe(true);
    expect(result.status).not.toBe(502);
    expect(result).not.toHaveProperty("resetsAtMs");
  });

  it.each([
    FORMATS.GEMINI,
    FORMATS.GEMINI_CLI,
    FORMATS.ANTIGRAVITY,
    FORMATS.VERTEX,
    FORMATS.OLLAMA
  ])("accepts emitted Responses content for a %s client", async (sourceFormat) => {
    const result = await handleNonStreamingResponse(options({
      id: "resp_test", object: "response", status: "completed", model: "gpt-test",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "translated answer" }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }
    }, { sourceFormat, targetFormat: FORMATS.OPENAI_RESPONSES }));

    expect(result.success).toBe(true);
    expect(result.status).not.toBe(502);
    expect(result).not.toHaveProperty("resetsAtMs");
  });

  it("accepts useful content in an emitted Gemini body", async () => {
    const body = {
      candidates: [{ content: { parts: [{ text: "gemini answer" }] }, finishReason: "STOP" }]
    };
    const result = await handleNonStreamingResponse(options(body, {
      sourceFormat: FORMATS.GEMINI,
      targetFormat: FORMATS.GEMINI
    }));

    expect(result.success).toBe(true);
    expect((await result.response.json()).candidates[0].content.parts[0].text).toBe("gemini answer");
  });

  it("accepts useful content in an emitted Ollama body", async () => {
    const body = {
      model: "llama3.2",
      message: { role: "assistant", content: "ollama answer" },
      done: true,
      done_reason: "stop"
    };
    const result = await handleNonStreamingResponse(options(body, {
      sourceFormat: FORMATS.OLLAMA,
      targetFormat: FORMATS.OLLAMA
    }));

    expect(result.success).toBe(true);
    expect((await result.response.json()).message.content).toBe("ollama answer");
  });

  it("accepts useful content in an emitted Claude body", async () => {
    const body = {
      id: "msg-test",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "claude answer" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 2, output_tokens: 1 }
    };
    const result = await handleNonStreamingResponse(options(body, {
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.CLAUDE
    }));

    expect(result.success).toBe(true);
    expect((await result.response.json()).content[0].text).toBe("claude answer");
  });

  it("projects a Responses body into OpenAI chat content", () => {
    const translated = translateNonStreamingResponse({
      id: "resp_test", object: "response", status: "completed", model: "gpt-test",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }
    }, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);

    expect(translated.choices[0].message.content).toBe("answer");
  });

});

describe("stream empty-content cooldown (#3465)", () => {
  it("reports a completed stream with no text, thinking, or output tokens", () => {
    const onEmptyStream = vi.fn();
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai", model: "gpt-test", requestStartTime: Date.now(),
      body: {}, stream: true, onEmptyStream
    });

    onStreamComplete({ content: "", thinking: "" }, { prompt_tokens: 3, completion_tokens: 0 });

    expect(onEmptyStream).toHaveBeenCalledOnce();
  });

  it("does not report a tool-call-only stream with absent usage as empty", async () => {
    const onEmptyStream = vi.fn();
    const completion = buildOnStreamComplete({
      provider: "openai", model: "gpt-test", requestStartTime: Date.now(),
      body: {}, stream: true, onEmptyStream
    });
    const toolCall = {
      id: "chatcmpl-tool", object: "chat.completion.chunk", model: "gpt-test",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run", arguments: "{}" } }] },
        finish_reason: "tool_calls"
      }]
    };
    const result = await handleStreamingResponse({
      ...options({}, { ...completion, stream: true }),
      providerResponse: new Response(`data: ${JSON.stringify(toolCall)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" }
      }),
      streamController: createStreamController({ provider: "openai", model: "gpt-test" })
    });

    await result.response.text();
    await vi.waitFor(() => expect(onEmptyStream).not.toHaveBeenCalled());
  });

  it("uses the configured cooldown when the callback benches an account", async () => {
    const markAccountUnavailable = vi.fn(async (...args) => args);
    const startedAt = Date.now();
    const onEmptyStream = async () => markAccountUnavailable(
      "connection-test", 502, "Empty streaming response", "openai", "gpt-test",
      Date.now() + EMPTY_CONTENT_COOLDOWN_MS
    );
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai", model: "gpt-test", requestStartTime: startedAt,
      body: {}, stream: true, onEmptyStream
    });

    onStreamComplete({ content: "", thinking: "" }, { completion_tokens: 0 });
    await vi.waitFor(() => expect(markAccountUnavailable).toHaveBeenCalledOnce());

    const resetsAtMs = markAccountUnavailable.mock.calls[0][5];
    expect(resetsAtMs).toBeGreaterThanOrEqual(startedAt + EMPTY_CONTENT_COOLDOWN_MS);
  });
});