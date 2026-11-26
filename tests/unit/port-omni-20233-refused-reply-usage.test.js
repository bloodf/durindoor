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

describe("OmniRoute #20233: a refused non-streaming reply is not a success", () => {
  it("records one failed row with the billed tokens and no 200 log", async () => {
    const appendLog = vi.fn();
    const onRequestSuccess = vi.fn();
    const result = await handleNonStreamingResponse({
      providerResponse: Response.json({
        choices: [{ message: { role: "assistant", content: null }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 }
      }),
      provider: "openai", model: "gpt-test", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
      body: { model: "gpt-test", messages: [{ role: "user", content: "hi" }] },
      stream: false, streamToClient: false, requestStartTime: Date.now(), connectionId: "connection-test",
      clientRawRequest: { endpoint: "/v1/chat/completions" }, onRequestSuccess, terminalProvenance: "upstream",
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
      trackDone: vi.fn(), appendLog, log: { warn: vi.fn(), line: vi.fn() }
    });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(usageDb.saveRequestUsage.mock.calls[0][0]).toMatchObject({ status: "error", tokens: { prompt_tokens: 11, completion_tokens: 3 } });
    expect(appendLog.mock.calls.map(([entry]) => entry.status)).toEqual(["FAILED 502 (empty content)"]);
  });
});
