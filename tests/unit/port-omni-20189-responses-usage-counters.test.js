import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

async function responsesClientUsage(usage) {
  const upstream = {
    id: "resp_1",
    object: "response",
    status: "completed",
    output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] }],
    usage,
  };
  const result = await handleNonStreamingResponse({
    providerResponse: new Response(JSON.stringify(upstream), { headers: { "content-type": "application/json" } }),
    provider: "openai",
    model: "gpt-5.5",
    sourceFormat: FORMATS.OPENAI_RESPONSES,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    body: { model: "gpt-5.5", input: "hi" },
    stream: false,
    streamToClient: false,
    requestStartTime: Date.now(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });
  expect(result.success).toBe(true);
  return (await result.response.json()).usage;
}

describe("OmniRoute #20189 - required counters in final Responses usage", () => {
  it("adds cached_tokens beside reported cache creation", async () => {
    const usage = await responsesClientUsage({
      input_tokens: 8199,
      output_tokens: 4,
      total_tokens: 8203,
      input_tokens_details: { cache_creation_tokens: 7886 },
    });

    expect(usage.input_tokens_details).toEqual({ cached_tokens: 0, cache_creation_tokens: 7886 });
    expect(usage.output_tokens).toBe(4);
  });

  it("replaces null counters and fills empty details and a missing total", async () => {
    vi.stubEnv("USAGE_BUFFER_TOKENS", "0");
    const usage = await responsesClientUsage({
      input_tokens: 10,
      output_tokens: 2,
      input_tokens_details: { cached_tokens: null, cache_write_tokens: null },
      output_tokens_details: {},
    });
    vi.unstubAllEnvs();

    expect(usage.input_tokens_details).toEqual({ cached_tokens: 0, cache_write_tokens: 0 });
    expect(usage.output_tokens_details).toEqual({ reasoning_tokens: 0 });
    expect(usage.total_tokens).toBe(12);
  });

  it("keeps reported cache and reasoning counts", async () => {
    const usage = await responsesClientUsage({
      input_tokens: 100,
      output_tokens: 4,
      total_tokens: 104,
      input_tokens_details: { cached_tokens: 70, cache_creation_tokens: 8 },
      output_tokens_details: { reasoning_tokens: 2 },
    });

    expect(usage.input_tokens_details).toEqual({ cached_tokens: 70, cache_creation_tokens: 8 });
    expect(usage.output_tokens_details).toEqual({ reasoning_tokens: 2 });
  });

  it("fills the counters on a forced-stream reply too", async () => {
    const completed = {
      type: "response.completed",
      response: {
        id: "resp_1",
        object: "response",
        status: "completed",
        output: [{ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }],
        usage: { input_tokens: 20, output_tokens: 3, total_tokens: 23, input_tokens_details: { cache_creation_tokens: 12 } },
      },
    };
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(`event: response.completed\ndata: ${JSON.stringify(completed)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-5.5",
      body: { model: "gpt-5.5", input: "hi" },
      stream: false,
      requestStartTime: Date.now(),
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect((await result.response.json()).usage.input_tokens_details).toEqual({ cached_tokens: 0, cache_creation_tokens: 12 });
  });
});
