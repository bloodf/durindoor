// Port of OmniRoute #14243 (fixes upstream #14160): an empty antigravity
// completion paired with a normal terminal stop is a real, legitimate
// answer, not the empty-200-shell failure hasUsefulContent() guards against
// for free/scraping providers. Before this fix, handleNonStreamingResponse
// returned a synthetic 502 and cooled the model down, benching a healthy
// account on a prompt that legitimately has no text to say. Every other
// provider, and antigravity itself on a non-normal finish, must keep the
// guard.
import { describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function openAICompletion(finishReason, content = "") {
  return JSON.stringify({
    id: "chatcmpl-empty",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "gemini-3-flash",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
  });
}

function baseOptions(overrides = {}) {
  return {
    sourceFormat: "openai",
    targetFormat: "openai",
    body: {},
    stream: false,
    streamToClient: false,
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "conn-14243",
    apiKey: "test-key",
    clientRawRequest: {},
    onRequestSuccess: vi.fn(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: {},
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    pxpipe: null,
    reqTag: "port-14243",
    log: { warn: vi.fn(), line: vi.fn() },
    usageEventId: "evt-14243",
    claudeClassifierCompat: "off",
    ...overrides,
  };
}

describe("port 14243 — antigravity empty completion with a normal stop is a valid 200", () => {
  it("passes an empty antigravity completion with finish_reason 'stop' through as 200", async () => {
    const response = new Response(openAICompletion("stop"), { headers: { "content-type": "application/json" } });
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: response,
      provider: "antigravity",
      model: "gemini-3-flash",
    }));

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("");
  });

  it("still flags an empty completion from an untrusted provider as a 502", async () => {
    const response = new Response(openAICompletion("stop"), { headers: { "content-type": "application/json" } });
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: response,
      provider: "openai",
      model: "gpt-test",
    }));

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("still flags an empty antigravity completion with no terminal stop reason", async () => {
    const response = new Response(openAICompletion("length"), { headers: { "content-type": "application/json" } });
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: response,
      provider: "antigravity",
      model: "gemini-3-flash",
    }));

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("keeps flagging a non-empty-safe provider even paired with a normal stop", async () => {
    const response = new Response(openAICompletion("stop"), { headers: { "content-type": "application/json" } });
    const result = await handleNonStreamingResponse(baseOptions({
      providerResponse: response,
      provider: "agy",
      model: "gemini-3-flash",
    }));

    expect(result.success).toBe(true);
  });
});
