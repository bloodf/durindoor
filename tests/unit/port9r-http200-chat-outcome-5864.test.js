import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()), saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()), trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
}));
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { buildOnStreamComplete, handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const context = (providerResponse, overrides = {}) => ({
  providerResponse, provider: "openai", model: "m", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
  body: { model: "m", messages: [{ role: "user", content: "hi" }] }, stream: false, requestStartTime: Date.now(),
  connectionId: "c", clientRawRequest: { endpoint: "/v1/chat/completions" }, terminalProvenance: "upstream",
  onRequestSuccess: vi.fn(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
  trackDone: vi.fn(), appendLog: vi.fn(), ...overrides,
});
const json = (payload) => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
const frame = (delta, finish = null, extra = {}) =>
  `data: ${JSON.stringify({ id: "c1", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
const forced = (finish, extra) => context(new Response(frame({ role: "assistant" }) + frame({}, finish, extra) + "data: [DONE]\n\n", {
  headers: { "content-type": "text/event-stream" },
}));

describe("upstream 9router #5864 HTTP 200 chat outcomes", () => {
  it.each([
    ["Chat content_filter", FORMATS.OPENAI, { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "content_filter" }] }],
    ["Gemini SAFETY", FORMATS.GEMINI, { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }],
  ])("returns an empty %s answer instead of failing over", async (_name, targetFormat, payload) => {
    const result = await handleNonStreamingResponse(context(json(payload), { targetFormat }));
    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].finish_reason).toBe("content_filter");
  });

  it("rejects a forced-SSE plain stop with no output before success is recorded", async () => {
    const ctx = forced("stop");
    const result = await handleForcedSSEToJson(ctx);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ["content_filter", undefined],
    ["stop", { usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 } }],
  ])("keeps a forced-SSE %s reply that is a real answer", async (finish, extra) => {
    expect((await handleForcedSSEToJson(forced(finish, extra))).success).toBe(true);
  });

  it("reports a 200 HTML page on a streaming request as 502", async () => {
    const result = await handleStreamingResponse({
      ...context(new Response("<html><title>Bad gateway</title></html>", { headers: { "content-type": "text/html" } }), { stream: true }),
      userAgent: "", streamController: createStreamController({ provider: "openai", model: "m" }),
      ...buildOnStreamComplete({ provider: "openai", model: "m", requestStartTime: Date.now(), body: {}, clientRawRequest: {} }),
    });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.response.status).toBe(502);
  });
});
