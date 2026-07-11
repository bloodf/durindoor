import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function responsesSse() {
  const frames = [
    ["response.created", { response: { id: "resp-upstream", created_at: 123 } }],
    ["response.output_item.done", {
      output_index: 0,
      item: { type: "message", id: "msg-1", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
    }],
    ["response.completed", { response: { usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }],
  ];
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function chatSse() {
  return [
    `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: "chat-upstream", created: 123, model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function makeContext({ sourceFormat, targetFormat, raw, provider = "openai" }) {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat,
    provider,
    model: "gpt-test",
    body: { model: "gpt-test", stream: false },
    stream: true,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: vi.fn(async () => {}),
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() },
    usageEventId: "event-test",
  };
}

describe("forced SSE to JSON format axes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("projects a Responses upstream stream to an OpenAI client completion", async () => {
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: responsesSse(),
      provider: "codex",
    }));
    const body = await result.response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("hello");
  });

  it("projects an OpenAI upstream stream to a Responses client object", async () => {
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      raw: chatSse(),
    }));
    const body = await result.response.json();
    expect(body.object).toBe("response");
    expect(body.output[0].content[0].text).toBe("hello");
  });

  it("keeps Responses JSON native when client and upstream both use Responses", async () => {
    const result = await handleForcedSSEToJson(makeContext({
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      raw: responsesSse(),
      provider: "codex",
    }));
    const body = await result.response.json();
    expect(body.object).toBe("response");
    expect(body.id).toBe("resp-upstream");
    expect(body.output[0].content[0].text).toBe("hello");
  });
});
