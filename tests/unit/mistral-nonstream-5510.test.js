import { describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));
const parts = [{ type: "thinking", thinking: [{ type: "text", text: "thought" }] }, { type: "text", text: "answer" }];
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;

describe("Mistral non-stream reasoning (#5510)", () => {
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
