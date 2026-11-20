import { describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));
const parts = [{ type: "thinking", thinking: [{ type: "text", text: "thought" }] }, { type: "text", text: "answer" }];
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;

describe("Mistral non-stream reasoning (#5510)", () => {
  it("serializes normalized content even when the stream chunk already has all standard fields", async () => {
    const chunk = { id: "chatcmpl-12345678", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta: { content: parts }, finish_reason: null }] };
    const input = new Response(frame(chunk) + frame({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\n\n");
    const out = await new Response(input.body.pipeThrough(createSSEStream({ mode: "passthrough", provider: "mistral", targetFormat: FORMATS.OPENAI }))).text();
    expect(JSON.parse(out.split("\n").find((line) => line.startsWith("data: {" )).slice(6)).choices[0].delta).toMatchObject({ content: "answer", reasoning_content: "thought" });
  });
  it("does not reintroduce rejected reasoning history after model injection", () => {
    const body = new DefaultExecutor("mistral").transformRequest("deepseek-v4", { messages: [{ role: "assistant", content: "answer", reasoning_content: "prior" }] });
    expect(body.messages[0]).toEqual({ role: "assistant", content: "answer" });
  });

  it("accumulates typed SSE content and preserves tool and finish data", () => {
    const sse = frame({ choices: [{ index: 0, delta: { content: parts, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n";
    const parsed = parseSSEToOpenAIResponse(sse, "test", { provider: "mistral" });
    expect(parsed.choices[0]).toMatchObject({ message: { content: "answer", reasoning_content: "thought", tool_calls: [{ id: "call_1" }] }, finish_reason: "tool_calls" });
  });

  it("normalizes a JSON completion before returning it", async () => {
    const response = { id: "test", model: "test", choices: [{ index: 0, message: { role: "assistant", content: parts }, finish_reason: "stop" }] };
    const result = await handleNonStreamingResponse({ providerResponse: Response.json(response), provider: "mistral", model: "test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, body: { messages: [] }, stream: false, requestStartTime: Date.now(), connectionId: "test", trackDone: vi.fn(), appendLog: vi.fn(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, onRequestSuccess: vi.fn(async () => {}) });
    expect((await result.response.json()).choices[0].message).toMatchObject({ content: "answer", reasoning_content: "thought" });
  });
});
