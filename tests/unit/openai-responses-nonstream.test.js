import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

const { EMPTY_CONTENT_COOLDOWN_MS } = await import("../../open-sse/config/errorConfig.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse, translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");

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

  it("does not report tool-only output with generated tokens as empty", () => {
    const onEmptyStream = vi.fn();
    const { onStreamComplete } = buildOnStreamComplete({
      provider: "openai", model: "gpt-test", requestStartTime: Date.now(),
      body: {}, stream: true, onEmptyStream
    });

    onStreamComplete({ content: "", thinking: "" }, { completion_tokens: 1 });

    expect(onEmptyStream).not.toHaveBeenCalled();
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