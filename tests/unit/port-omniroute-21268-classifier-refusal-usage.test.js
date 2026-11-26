// OmniRoute #21268 (a5a6b3f9ff9b): a non-streaming reply refused after
// translation is one failed usage row carrying the tokens the provider billed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageDb = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("@/lib/usageDb.js", () => usageDb);

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const SECURITY_MARKER = "You are a security monitor for autonomous AI coding agents";

function options(usage) {
  const body = {
    model: "gpt-test", stream: false, stop_sequences: ["</block>"], system: SECURITY_MARKER,
    messages: [{ role: "user", content: "run ls" }]
  };
  return {
    providerResponse: Response.json({
      choices: [{ message: { role: "assistant", content: "I am not sure." }, finish_reason: "stop" }],
      ...(usage ? { usage } : null)
    }),
    provider: "openai", model: "gpt-test", sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.OPENAI,
    body, stream: false, streamToClient: false, claudeClassifierCompat: "auto",
    requestStartTime: Date.now(), connectionId: "connection-test",
    clientRawRequest: { endpoint: "/v1/messages" },
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
    trackDone: vi.fn(), appendLog: vi.fn(), onRequestSuccess: vi.fn(), terminalProvenance: "upstream",
    log: { warn: vi.fn(), line: vi.fn() }
  };
}

beforeEach(() => vi.clearAllMocks());

describe("OmniRoute #21268: refused classifier reply accounting", () => {
  it("records one failed row with the billed tokens", async () => {
    const request = options({ prompt_tokens: 120, completion_tokens: 7, total_tokens: 127 });
    const result = await handleNonStreamingResponse(request);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("invalid decision");
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(usageDb.saveRequestUsage.mock.calls[0][0]).toMatchObject({
      status: "error", provider: "openai", model: "gpt-test",
      tokens: { prompt_tokens: 120, completion_tokens: 7 }
    });
    expect(request.appendLog).toHaveBeenCalledTimes(1);
    expect(request.appendLog.mock.calls[0][0].status).toBe("FAILED 502 (invalid classifier decision)");
    expect(request.onRequestSuccess).not.toHaveBeenCalled();
  });

  it("records no estimate when the provider reported no usage", async () => {
    const request = options();
    const result = await handleNonStreamingResponse(request);

    expect(result.success).toBe(false);
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
    expect(request.appendLog).toHaveBeenCalledWith({ status: "FAILED 502 (invalid classifier decision)" });
  });

  const sse = (events) => new Response(`${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" }
  });

  it.each([
    ["Chat Completions", FORMATS.OPENAI, "openai", [
      { id: "c1", object: "chat.completion.chunk", model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "I am not sure." } }] },
      { id: "c1", object: "chat.completion.chunk", model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 7 } }
    ]],
    ["Responses", FORMATS.OPENAI_RESPONSES, "codex", [
      { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "I am not sure." }] } },
      { type: "response.completed", response: { id: "r1", status: "completed", output: [], usage: { input_tokens: 120, output_tokens: 7 } } }
    ]]
  ])("records one failed row on the forced %s SSE path", async (_name, targetFormat, provider, events) => {
    const request = { ...options(), providerResponse: sse(events), provider, targetFormat };
    const result = await handleForcedSSEToJson(request);

    expect(result.status).toBe(502);
    expect(result.error).toContain("invalid decision");
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(usageDb.saveRequestUsage.mock.calls[0][0]).toMatchObject({ status: "error", provider });
    expect(request.appendLog).toHaveBeenCalledTimes(1);
    expect(request.appendLog.mock.calls[0][0].status).toBe("FAILED 502 (invalid classifier decision)");
    expect(request.onRequestSuccess).not.toHaveBeenCalled();
  });
});
