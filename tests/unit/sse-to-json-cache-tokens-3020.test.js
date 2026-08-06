import { describe, expect, it, vi } from "vitest";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn((detail) => Promise.resolve(detail)),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

function responsesProviderResponse({ output, usage }) {
  const events = [
    `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", object: "response", status: "in_progress", output: [] } })}`,
  ];
  for (const item of output || []) {
    events.push(`event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: item.output_index ?? 0, item: item.item })}`);
  }
  events.push(
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", object: "response", status: "completed", output, usage } })}`,
  );
  const stream = new ReadableStream({
    start(controller) {
      for (const line of events) {
        controller.enqueue(new TextEncoder().encode(`${line}\n\n`));
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function baseOpts(overrides = {}) {
  return {
    provider: "codex",
    model: "gpt-4.1",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: "gpt-4.1", messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "conn-3020",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(() => Promise.resolve()),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    toolNameMap: null,
    reqTag: "t",
    log: null,
    ...overrides,
  };
}

async function project(opts) {
  const result = await handleForcedSSEToJson(opts);
  expect(result).not.toBeNull();
  return JSON.parse(await result.response.text());
}

describe("handleForcedSSEToJson cache token accounting (#3020)", () => {
  it("sums cached and created tokens into prompt_tokens and preserves details", async () => {
    const json = await project(baseOpts({
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage: {
          input_tokens: 2012,
          output_tokens: 5,
          cache_read_input_tokens: 5332,
          cache_creation_input_tokens: 12,
        },
      }),
    }));

    expect(json.usage).toMatchObject({
      prompt_tokens: 7356,
      completion_tokens: 5,
      total_tokens: 7361,
      prompt_tokens_details: {
        cached_tokens: 5332,
        cache_creation_tokens: 12,
      },
    });
  });

  it.each([
    ["cache read only", { cached_tokens: 80 }, { cached_tokens: 80 }, { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80 }],
    ["cache creation only", { cache_creation_tokens: 80 }, { cache_creation_tokens: 80 }, { input_tokens: 20, output_tokens: 5, cache_creation_input_tokens: 80 }],
    ["cache read and creation", { cached_tokens: 70, cache_creation_tokens: 10 }, { cached_tokens: 70, cache_creation_tokens: 10 }, { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 70, cache_creation_input_tokens: 10 }],
  ])("preserves nested Responses %s usage", async (_name, inputTokensDetails, expectedDetails, expectedClaude) => {
    const usage = { input_tokens: 100, output_tokens: 5, total_tokens: 105, input_tokens_details: inputTokensDetails };
    const output = [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }];
    const native = await project(baseOpts({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      providerResponse: responsesProviderResponse({ output, usage }),
    }));
    const claude = await project(baseOpts({
      sourceFormat: FORMATS.CLAUDE,
      providerResponse: responsesProviderResponse({ output, usage }),
    }));

    expect(native.usage).toEqual({
      input_tokens: 100,
      output_tokens: 5,
      total_tokens: 105,
      input_tokens_details: expectedDetails,
    });
    expect(claude.usage).toEqual(expectedClaude);
  });

  it("normalizes cache-exclusive usage for native OpenAI Responses", async () => {
    const json = await project(baseOpts({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          cache_read_input_tokens: 70,
          cache_creation_input_tokens: 10,
        },
      }),
    }));

    expect(json.usage).toEqual({
      input_tokens: 100,
      output_tokens: 5,
      total_tokens: 105,
      input_tokens_details: { cached_tokens: 70, cache_creation_tokens: 10 },
    });
  });

  it("clamps malformed negative native Responses counters", async () => {
    const json = await project(baseOpts({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: -70 },
      }),
    }));

    expect(json.usage).toEqual({ input_tokens: 20, output_tokens: 5, total_tokens: 25 });
  });

  it("does not double-count cache-inclusive native OpenAI Responses usage", async () => {
    const json = await project(baseOpts({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage: {
          input_tokens: 100,
          output_tokens: 5,
          total_tokens: 105,
          input_tokens_details: { cached_tokens: 70 },
          cache_creation_input_tokens: 10,
        },
      }),
    }));

    expect(json.usage).toEqual({
      input_tokens: 100,
      output_tokens: 5,
      total_tokens: 105,
      input_tokens_details: { cached_tokens: 70, cache_creation_tokens: 10 },
    });
  });

  it.each([
    ["cache read only", { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80 }, { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80 }],
    ["cache creation only", { input_tokens: 20, output_tokens: 5, cache_creation_input_tokens: 80 }, { input_tokens: 20, output_tokens: 5, cache_creation_input_tokens: 80 }],
    ["cache read and creation", { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 70, cache_creation_input_tokens: 10 }, { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 70, cache_creation_input_tokens: 10 }],
    ["cache-inclusive totals", { input_tokens: 100, output_tokens: 5, total_tokens: 105, input_tokens_details: { cached_tokens: 70 }, cache_creation_input_tokens: 10 }, { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 70, cache_creation_input_tokens: 10 }],
    ["malformed cache totals", { input_tokens: 5, output_tokens: 5, total_tokens: 10, input_tokens_details: { cached_tokens: 10 }, cache_creation_input_tokens: 10 }, { input_tokens: 0, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 10 }],
  ])("projects Claude %s without negative input tokens", async (_name, usage, expected) => {
    const json = await project(baseOpts({
      sourceFormat: FORMATS.CLAUDE,
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage,
      }),
    }));

    expect(json.usage).toEqual(expected);
    expect(json.usage.input_tokens).toBeGreaterThanOrEqual(0);
  });

  it("projects only Gemini's documented cached-content counter", async () => {
    const json = await project(baseOpts({
      sourceFormat: FORMATS.GEMINI,
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage: {
          input_tokens: 20,
          output_tokens: 5,
          cache_read_input_tokens: 70,
          cache_creation_input_tokens: 10,
        },
      }),
    }));

    expect(json.response.usageMetadata).toEqual({
      promptTokenCount: 100,
      candidatesTokenCount: 5,
      totalTokenCount: 105,
      cachedContentTokenCount: 70,
    });
  });

  it("keeps ordinary usage unchanged when no cache fields are present", async () => {
    const json = await project(baseOpts({
      providerResponse: responsesProviderResponse({
        output: [{ output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] } }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    }));

    expect(json.usage).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
    });
    expect(json.usage.prompt_tokens_details).toBeUndefined();
  });
});
