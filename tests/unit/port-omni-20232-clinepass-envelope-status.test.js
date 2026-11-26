import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

const run = (envelope) => handleNonStreamingResponse({
  providerResponse: Response.json(envelope), provider: "clinepass", model: "m", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
  body: { model: "m", messages: [{ role: "user", content: "hi" }] }, stream: false, streamToClient: false,
  requestStartTime: Date.now(), connectionId: "c", clientRawRequest: { endpoint: "/v1/chat/completions" },
  reqLogger: { logProviderResponse() {}, logConvertedResponse() {} }, trackDone: vi.fn(), appendLog: vi.fn(), log: { warn: vi.fn(), line: vi.fn() }
});

describe("OmniRoute #20232: ClinePass envelope status", () => {
  it("keeps the status the envelope names", async () => {
    expect(await run({ success: false, statusCode: 429, error: "slow down" })).toMatchObject({ success: false, status: 429 });
  });

  it.each([undefined, 200, "429"])("answers 502 when the status is %s", async (statusCode) => {
    expect(await run({ success: false, statusCode, error: "failed" })).toMatchObject({ success: false, status: 502 });
  });
});
