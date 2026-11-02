import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveUsageStats, saveRequestDetail } from "@/lib/usageDb.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
  extractRequestConfig: vi.fn(() => ({})), buildRequestDetail: vi.fn((args) => args),
  formatDoneLine: vi.fn(() => "done"),
}));

const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const completeMessage = frame({
  id: "done", model: "test", choices: [{ index: 0, delta: { content: "complete text" }, finish_reason: "stop" }],
});
function options(error, partial = false, { prefixFrames = "", sourceFormat = FORMATS.OPENAI, targetFormat = FORMATS.OPENAI } = {}) {
  const prefix = prefixFrames || (partial ? frame({
    id: "partial", model: "test", choices: [{ index: 0, delta: { content: "partial text" }, finish_reason: null }],
  }) : "");
  return {
    providerResponse: new Response(prefix + frame({ error }) + "data: [DONE]\n\n", {
      status: 200, headers: { "content-type": "text/event-stream" },
    }),
    provider: "openai", model: "test", sourceFormat, targetFormat,
    body: { messages: [{ role: "user", content: "hello" }] }, stream: false,
    translatedBody: null, finalBody: null, requestStartTime: Date.now(), connectionId: "test-1355",
    onRequestSuccess: vi.fn(async () => {}), trackDone: vi.fn(), appendLog: vi.fn(),
    reqLogger: { logProviderResponse: vi.fn() }, terminalProvenance: "upstream",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
  };
}

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["non-stream handler", handleNonStreamingResponse],
  ["forced SSE-to-JSON", handleForcedSSEToJson],
])("SSE error envelopes: %s", (_label, handle) => {
  it.each([400, 401, 429, 500, 599, "429"])("preserves valid upstream error status %j", async (status) => {
    const opts = options({ status, message: "Upstream unavailable" });
    const result = await handle(opts);
    expect(result).toMatchObject({ success: false, status: Number(status), error: "Upstream unavailable" });
    expect(result.response.status).toBe(Number(status));
    expect(opts.appendLog).toHaveBeenCalledWith({ status: `FAILED ${Number(status)}` });
    expect(opts.trackDone).toHaveBeenCalledOnce();
    expect(opts.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
    expect(saveRequestDetail).not.toHaveBeenCalled();
    expect(opts.reqLogger.logProviderResponse).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 200, 600, 429.5, "invalid", [429], true])("uses 502 for invalid status %j", async (status) => {
    const result = await handle(options({ status, message: "Upstream unavailable" }));
    expect(result).toMatchObject({ success: false, status: 502, error: "Upstream unavailable" });
  });

  it("rejects partial content followed by an error and redacts the message", async () => {
    const opts = options({ status: 429, message: "Rejected Bearer sensitive-token-1355", details: "do-not-forward" }, true);
    const result = await handle(opts);
    const clientBody = await result.response.json();
    expect(result).toMatchObject({ success: false, status: 429 });
    expect(result.error).toContain("[redacted]");
    expect(JSON.stringify(clientBody)).not.toMatch(/sensitive-token-1355|do-not-forward|partial text/);
    expect(opts.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
    expect(opts.trackDone).toHaveBeenCalledOnce();
  });

  it("uses 502 for an OpenRouter-style envelope with code but no status", async () => {
    const result = await handle(options({ code: 502, message: "Provider returned error" }));
    expect(result).toMatchObject({ success: false, status: 502, error: "Provider returned error" });
  });

  it("rejects an error frame that follows a complete message", async () => {
    const opts = options({ status: 429, message: "late failure" }, false, { prefixFrames: completeMessage });
    const result = await handle(opts);
    expect(result).toMatchObject({ success: false, status: 429, error: "late failure" });
    expect(JSON.stringify(await result.response.json())).not.toContain("complete text");
    expect(opts.onRequestSuccess).not.toHaveBeenCalled();
    expect(saveUsageStats).not.toHaveBeenCalled();
  });

  it("preserves the status for a Claude-source request routed to a KIRO target", async () => {
    const opts = options({ status: 429, message: "Upstream unavailable" }, false, { sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.KIRO });
    const result = await handle(opts);
    expect(result).toMatchObject({ success: false, status: 429, error: "Upstream unavailable" });
    expect(opts.onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([{}, { message: {} }, { message: "" }])("uses a safe fallback for absent/non-string error message %j", async (error) => {
    const result = await handle(options(error));
    expect(result).toMatchObject({ success: false, status: 502, error: "Upstream SSE stream failed" });
  });

  it("redacts unlabelled opaque selected credentials in returned errors", async () => {
    const credentials = { apiKey: "opaque-selected-1355-value", providerSpecificData: { sessionToken: "opaque-session-1355-value" } };
    const opts = options({ status: 401, message: `Rejected ${credentials.apiKey} and ${credentials.providerSpecificData.sessionToken}` });
    opts.credentials = credentials;
    const result = await handle(opts);
    const clientBody = await result.response.json();
    for (const secret of [credentials.apiKey, credentials.providerSpecificData.sessionToken]) {
      expect(result.error).not.toContain(secret);
      expect(JSON.stringify(clientBody)).not.toContain(secret);
      expect(JSON.stringify(opts.appendLog.mock.calls)).not.toContain(secret);
    }
    expect(result.error).toContain("[redacted]");
    expect(result.status).toBe(401);
    expect(opts.onRequestSuccess).not.toHaveBeenCalled();
  });
});
