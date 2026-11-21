import { describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse, translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));

describe("non-stream SSE projection (#5380)", () => {
  it("projects an accumulated tool call back to Claude even when transport was Claude", async () => {
    const chunk = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
    const result = await handleNonStreamingResponse({ providerResponse: new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }), provider: "test", model: "test", sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.CLAUDE, body: { messages: [] }, stream: false, requestStartTime: Date.now(), connectionId: "test", trackDone: vi.fn(), appendLog: vi.fn(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, onRequestSuccess: vi.fn(async () => {}) });
    const body = await result.response.json();
    expect(body.content).toContainEqual(expect.objectContaining({ type: "tool_use", id: "call_1", name: "run" }));
    expect(body.stop_reason).toBe("tool_use");
  });

  it.each([FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE, FORMATS.CLAUDE, FORMATS.OPENAI])("preserves Ollama text, tools and usage for %s clients", async (sourceFormat) => {
    const fixture = { model: "toy-model", message: { role: "assistant", content: "hello", tool_calls: [{ id: "call_sample", function: { name: "lookup_color", arguments: { item: "ball" } } }] }, done: true, done_reason: "stop", prompt_eval_count: 12, eval_count: 3 };
    if (sourceFormat === FORMATS.OPENAI_RESPONSES || sourceFormat === FORMATS.OPENAI_RESPONSE) {
      expect(translateNonStreamingResponse(fixture, FORMATS.OLLAMA, sourceFormat).usage).toMatchObject({ input_tokens: 12, output_tokens: 3, total_tokens: 15 });
    }
    const result = await handleNonStreamingResponse({ providerResponse: new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } }), provider: "ollama-local", model: "toy-model", sourceFormat, targetFormat: FORMATS.OLLAMA, body: { messages: [] }, stream: false, requestStartTime: Date.now(), connectionId: "test", trackDone: vi.fn(), appendLog: vi.fn(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, onRequestSuccess: vi.fn(async () => {}) });
    expect(result.success).toBe(true);
    const body = await result.response.json();
    if (sourceFormat === FORMATS.CLAUDE) {
      expect(body).toMatchObject({ type: "message", stop_reason: "tool_use", usage: { input_tokens: 12, output_tokens: 3 } });
      expect(body.content).toContainEqual(expect.objectContaining({ type: "text", text: "hello" }));
      expect(body.content).toContainEqual(expect.objectContaining({ type: "tool_use", id: "call_sample", name: "lookup_color", input: { item: "ball" } }));
    } else if (sourceFormat === FORMATS.OPENAI) {
      expect(body).toMatchObject({ object: "chat.completion", usage: { prompt_tokens: 2012, completion_tokens: 3, total_tokens: 2015 }, choices: [{ finish_reason: "tool_calls", message: { content: "hello", tool_calls: [{ id: "call_sample", function: { name: "lookup_color", arguments: '{"item":"ball"}' } }] } }] });
    } else {
      expect(body).toMatchObject({ object: "response", status: "completed", usage: { input_tokens: 2012, output_tokens: 3 } });
      expect(body.output).toContainEqual(expect.objectContaining({ type: "message", content: [expect.objectContaining({ type: "output_text", text: "hello" })] }));
      expect(body.output).toContainEqual(expect.objectContaining({ type: "function_call", call_id: "call_sample", name: "lookup_color", arguments: '{"item":"ball"}' }));
    }
  });
});
