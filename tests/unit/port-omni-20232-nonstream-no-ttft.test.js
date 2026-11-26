import { beforeEach, describe, expect, it, vi } from "vitest";

const usageDb = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("@/lib/usageDb.js", () => usageDb);

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

beforeEach(() => vi.clearAllMocks());

describe("OmniRoute #20232: a non-streaming reply has no measured TTFT", () => {
  it("records total latency but no time-to-first-token", async () => {
    const result = await handleNonStreamingResponse({
      providerResponse: Response.json({
        choices: [{ message: { role: "assistant", content: "Hello there." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 }
      }),
      provider: "openai", model: "gpt-test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-test", messages: [{ role: "user", content: "hi" }] },
      stream: false, streamToClient: false, requestStartTime: Date.now() - 500, connectionId: "connection-test",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
      trackDone: vi.fn(), appendLog: vi.fn(), log: { warn: vi.fn(), line: vi.fn() }
    });
    expect(result.success).toBe(true);
    const detail = usageDb.saveRequestDetail.mock.calls[0][0];
    expect(detail.latency.ttft).toBe(0);
    expect(detail.latency.total).toBeGreaterThanOrEqual(500);
    expect(usageDb.saveRequestUsage.mock.calls[0][0].ttftMs).toBe(0);
  });
});
