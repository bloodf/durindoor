import { describe, expect, it, vi } from "vitest";
import { parseJsonWithTrailingDone, handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));

describe("JSON followed by an SSE done marker (#5384)", () => {
  it("handles nested objects, braces and escapes inside strings", () => {
    const value = { nested: { text: 'a } " \\ b' } };
    expect(parseJsonWithTrailingDone(`${JSON.stringify(value)}data: [DONE]\n\n`)).toEqual(value);
  });
  it.each(['junk {}data: [DONE]', '{}data: [DONE]\ndata: {"error":1}', '{} trailing', '{"x":'])("rejects unrelated or malformed content: %s", (input) => {
    expect(parseJsonWithTrailingDone(input)).toBeNull();
  });
  it("returns the completion through the non-streaming handler", async () => {
    const body = { id: "test", model: "test", choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }] };
    const result = await handleNonStreamingResponse({ providerResponse: new Response(`${JSON.stringify(body)}data: [DONE]\n\n`, { headers: { "content-type": "application/json" } }), provider: "openai", model: "test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, body: { messages: [] }, stream: false, requestStartTime: Date.now(), connectionId: "test", trackDone: vi.fn(), appendLog: vi.fn(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, onRequestSuccess: vi.fn(async () => {}) });
    expect((await result.response.json()).choices[0].message.content).toBe("hello");
  });
});
