// Round 2 review findings on PR #4210 (upstream #4210, Claude refusal
// stop_reason mapping): a native Claude refusal must never surface as a
// retryable empty-content 502, whether the client also speaks Claude
// (same-format passthrough skips translation entirely) or the explanation
// is null/blank (the OpenAI pivot round trip loses the "refusal" marker,
// see fromOpenAIFinish in translator/concerns/finishReason.js).
import { describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function makeProviderResponse(body) {
  const text = JSON.stringify(body);
  return {
    headers: new Map([["content-type", "application/json"]]),
    text: () => Promise.resolve(text),
    status: 200,
    statusText: "OK",
  };
}

function options(providerResponse, { sourceFormat, targetFormat }) {
  return {
    providerResponse,
    provider: "anthropic",
    model: "claude-opus-5",
    sourceFormat,
    targetFormat,
    body: { model: "claude-opus-5", messages: [] },
    stream: false,
    streamToClient: false,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  };
}

describe("handleNonStreamingResponse: native Claude refusal never 502s", () => {
  it("same-format Claude passthrough (target === source) is not empty-content rejected", async () => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse({
      id: "msg_refusal_passthrough",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", explanation: "blocked" },
      usage: { input_tokens: 10, output_tokens: 0 },
    }), { sourceFormat: FORMATS.CLAUDE, targetFormat: FORMATS.CLAUDE }));

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.stop_reason).toBe("refusal");
  });

  it("Claude-native refusal with a null explanation is not empty-content rejected for an OpenAI client", async () => {
    const result = await handleNonStreamingResponse(options(makeProviderResponse({
      id: "msg_refusal_no_explanation",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: "refusal",
      stop_details: { type: "refusal", explanation: null },
      usage: { input_tokens: 10, output_tokens: 0 },
    }), { sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.CLAUDE }));

    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].finish_reason).toBe("content_filter");
  });
});
