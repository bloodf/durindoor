import { describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
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
});
