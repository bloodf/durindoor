// OmniRoute #19745: a successful non-streaming reply with no usage object
// persists an estimated input/output usage marked `estimated`; reported usage
// always wins; failed replies persist nothing new.
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageDb = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("@/lib/usageDb.js", () => usageDb);

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { measureResponseOutputLength } = await import("../../open-sse/utils/usageTracking.js");

function options(responseBody, overrides = {}) {
  return {
    providerResponse: Response.json(responseBody), provider: "openai", model: "gpt-test",
    sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI,
    body: { model: "gpt-test", messages: [{ role: "user", content: "Say hello to the estimated usage test." }] },
    stream: false, streamToClient: false,
    requestStartTime: Date.now(), connectionId: "connection-test",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
    trackDone: vi.fn(), appendLog: vi.fn(), log: { warn: vi.fn(), line: vi.fn() },
    ...overrides
  };
}

const completion = (message, usage) => ({
  choices: [{ message: { role: "assistant", ...message }, finish_reason: "stop" }],
  ...(usage ? { usage } : null)
});

beforeEach(() => vi.clearAllMocks());

describe("non-stream estimated usage (#19745)", () => {
  it("persists an estimate marked estimated when the provider reports no usage", async () => {
    const request = options(completion({ content: "Hello there, this is a reply of some length." }));
    const result = await handleNonStreamingResponse(request);

    expect(result.success).toBe(true);
    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    const saved = usageDb.saveRequestUsage.mock.calls[0][0];
    expect(saved.tokens.estimated).toBe(true);
    expect(saved.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(saved.tokens.completion_tokens).toBeGreaterThan(0);
    expect(saved).toMatchObject({ provider: "openai", model: "gpt-test", connectionId: "connection-test" });
    expect(request.appendLog).toHaveBeenCalledWith(expect.objectContaining({
      status: "200 OK",
      tokens: expect.objectContaining({ estimated: true })
    }));
  });

  it("does not add the estimate to the client-facing response", async () => {
    const result = await handleNonStreamingResponse(options(completion({ content: "Hi there friend." })));
    const body = await result.response.json();
    expect(body.usage).toBeUndefined();
  });

  it("estimates tool-call-only replies from the call payload", async () => {
    const call = { id: "call_1", type: "function", function: { name: "run", arguments: JSON.stringify({ path: "/tmp/file" }) } };
    const result = await handleNonStreamingResponse(options(completion({ content: null, tool_calls: [call] })));

    expect(result.success).toBe(true);
    const saved = usageDb.saveRequestUsage.mock.calls[0][0];
    expect(saved.tokens.estimated).toBe(true);
    expect(saved.tokens.completion_tokens).toBeGreaterThan(0);
  });

  it("prefers reported usage and never marks it estimated", async () => {
    const request = options(completion(
      { content: "Reported answer." },
      { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 }
    ));
    await handleNonStreamingResponse(request);

    expect(usageDb.saveRequestUsage).toHaveBeenCalledTimes(1);
    const saved = usageDb.saveRequestUsage.mock.calls[0][0];
    expect(saved.tokens).toMatchObject({ prompt_tokens: 11, completion_tokens: 3 });
    expect(saved.tokens.estimated).toBeUndefined();
    expect(request.appendLog).toHaveBeenCalledTimes(1);
  });

  it("keeps a reported zero-completion usage instead of estimating", async () => {
    await handleNonStreamingResponse(options(completion(
      { content: "ok" },
      { prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 }
    )));
    const saved = usageDb.saveRequestUsage.mock.calls[0][0];
    expect(saved.tokens).toMatchObject({ prompt_tokens: 7, completion_tokens: 0 });
    expect(saved.tokens.estimated).toBeUndefined();
  });

  it("persists no estimate for an empty-content failure", async () => {
    const request = options(completion({ content: null }));
    const result = await handleNonStreamingResponse(request);

    expect(result).toMatchObject({ success: false, status: 502 });
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
    expect(request.appendLog).not.toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({ estimated: true })
    }));
  });

  it("persists no estimate for an unparseable provider body", async () => {
    const result = await handleNonStreamingResponse(options(null, {
      providerResponse: new Response("<html>bad gateway</html>", { status: 200 })
    }));
    expect(result.success).toBe(false);
    expect(usageDb.saveRequestUsage).not.toHaveBeenCalled();
  });
});

describe("measureResponseOutputLength", () => {
  it("measures text, reasoning and tool payloads across dialects", () => {
    expect(measureResponseOutputLength(null)).toBe(0);
    expect(measureResponseOutputLength({ choices: [{ message: { content: "abcd", reasoning_content: "ef" } }] })).toBe(6);
    expect(measureResponseOutputLength({ type: "message", content: [{ type: "text", text: "abc" }, { type: "tool_use", name: "t", input: {} }] })).toBe(3 + 1 + 2);
    expect(measureResponseOutputLength({ output: [{ type: "message", content: [{ text: "abcde" }] }] })).toBe(5);
    expect(measureResponseOutputLength({ candidates: [{ content: { parts: [{ text: "abcdef" }] } }] })).toBe(6);
  });
});
