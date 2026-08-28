// Regression test for 9router#41606a37 — cached tokens must not be dropped
// when a provider forces SSE and the client asks for non-streaming JSON.
// Before the fix, usage that exposed `cache_read_input_tokens` lost the cache
// portion in the client-facing response AND the recorded request detail.
import { describe, expect, it, vi } from "vitest";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { responsesApiToOpenAICompletion } from "../../open-sse/translator/response/completionProjector.js";

const convertResponsesStreamToJson = vi.fn(() => Promise.resolve({}));
vi.mock("../../open-sse/transformer/streamToJsonConverter.js", () => ({
  convertResponsesStreamToJson: (...args) => convertResponsesStreamToJson(...args),
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  saveUsageStats: vi.fn(() => Promise.resolve()),
  extractRequestConfig: vi.fn(() => ({})),
  buildRequestDetail: vi.fn((args) => args),
  formatDoneLine: vi.fn(() => "📊 done"),
}));

// The `log` param is a request-scoped logger; we pass `null` so any unguarded
// `log?.line` access short-circuits. The handler's module-level `logToolSemantics`
// import is also null-safe.
vi.mock("../../open-sse/utils/toolSemanticsTrace.js", () => ({
  logToolSemantics: vi.fn(),
}));
describe("9router#41606a37 — cached tokens fold into client-format usage", () => {
  it("folds cache_read_input_tokens + input_tokens into prompt_tokens", () => {
    const jsonResponse = {
      id: "resp_1",
      object: "response",
      status: "completed",
      created_at: 1700000000,
      model: "claude-sonnet-4.6",
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 5332,
        cache_creation_input_tokens: 0,
        output_tokens: 7,
      },
    };

    const completion = responsesApiToOpenAICompletion(jsonResponse, "claude-sonnet-4.6");

    expect(completion.usage.prompt_tokens).toBe(12 + 5332 + 0);
    expect(completion.usage.completion_tokens).toBe(7);
    expect(completion.usage.total_tokens).toBe(12 + 5332 + 7);
  });

  it("exposes cache_creation_tokens and cached_tokens in prompt_tokens_details", () => {
    const jsonResponse = {
      id: "resp_2",
      object: "response",
      status: "completed",
      created_at: 1700000000,
      model: "claude-sonnet-4.6",
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 20,
        cache_read_input_tokens: 11022,
        cache_creation_input_tokens: 500,
        output_tokens: 50,
      },
    };

    const completion = responsesApiToOpenAICompletion(jsonResponse, "claude-sonnet-4.6");

    expect(completion.usage.prompt_tokens_details).toEqual({
      cached_tokens: 11022,
      cache_creation_tokens: 500,
    });
  });

  it("does not add inclusive Responses cache fields to prompt_tokens again", () => {
    const completion = responsesApiToOpenAICompletion({
      id: "resp_inclusive",
      status: "completed",
      output: [],
      usage: {
        input_tokens: 5_844,
        output_tokens: 50,
        total_tokens: 5_894,
        cached_tokens: 5_332,
        cache_creation_input_tokens: 500,
        input_tokens_details: { cached_tokens: 5_332, cache_creation_tokens: 500 },
      },
    }, "claude-sonnet-4.6");

    expect(completion.usage).toEqual({
      prompt_tokens: 5_844,
      prompt_tokens_details: { cached_tokens: 5_332, cache_creation_tokens: 500 },
      completion_tokens: 50,
      total_tokens: 5_894,
    });
  });

  it("omits prompt_tokens_details when there is no cache activity", () => {
    const jsonResponse = {
      id: "resp_3",
      object: "response",
      status: "completed",
      created_at: 1700000000,
      model: "claude-sonnet-4.6",
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      usage: {
        input_tokens: 30,
        output_tokens: 10,
      },
    };

    const completion = responsesApiToOpenAICompletion(jsonResponse, "claude-sonnet-4.6");

    expect(completion.usage.prompt_tokens).toBe(30);
    expect(completion.usage.prompt_tokens_details).toBeUndefined();
  });
});

describe("9router#41606a37 — saveRequestDetail records cache-inclusive prompt_tokens", () => {
  const jsonResponse = {
    id: "resp_1",
    object: "response",
    status: "completed",
    created_at: 1700000000,
    model: "claude-sonnet-4.6",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "hello" }],
      },
    ],
    usage: {
      input_tokens: 5344,
      output_tokens: 7,
      total_tokens: 5351,
      cached_tokens: 5332,
      input_tokens_details: { cached_tokens: 5332 },
    },
  };

  function baseOptions(overrides) {
    return {
      provider: "codex",
      model: "claude-sonnet-4.6",
      body: { model: "claude-sonnet-4.6", messages: [] },
      stream: false,
      streamToClient: false,
      requestStartTime: Date.now(),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      providerResponse: {
        headers: new Map([["content-type", "text/event-stream"]]),
        body: null,
        status: 200,
      },
      translatedBody: null,
      finalBody: null,
      connectionId: "conn_1",
      apiKey: "sk-test",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      onRequestSuccess: vi.fn(),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      toolNameMap: null,
      reqTag: "req-test",
      log: null,
      usageEventId: "evt_1",
      claudeClassifierCompat: "off",
      terminalProvenance: null,
      signal: null,
      ...overrides,
    };
  }

  it("records cache-inclusive prompt_tokens when client asked for Responses format", async () => {
    convertResponsesStreamToJson.mockResolvedValue(jsonResponse);

    const { saveRequestDetail } = await import("@/lib/usageDb.js");
    saveRequestDetail.mockClear();

    const result = await handleForcedSSEToJson(baseOptions({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
    }));

    expect(result.success).toBe(true);
    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    const recorded = saveRequestDetail.mock.calls[0][0];
    expect(recorded.tokens.prompt_tokens).toBe(12 + 5332);
    expect(recorded.tokens.completion_tokens).toBe(7);
  });

  it("records cache-inclusive prompt_tokens when client asked for chat-completion format", async () => {
    convertResponsesStreamToJson.mockResolvedValue(jsonResponse);

    const { saveRequestDetail } = await import("@/lib/usageDb.js");
    saveRequestDetail.mockClear();

    const result = await handleForcedSSEToJson(baseOptions({
      sourceFormat: FORMATS.OPENAI,
    }));

    expect(result.success).toBe(true);
    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    const recorded = saveRequestDetail.mock.calls[0][0];
    expect(recorded.tokens.prompt_tokens).toBe(12 + 5332);
    expect(recorded.tokens.completion_tokens).toBe(7);
  });
});
