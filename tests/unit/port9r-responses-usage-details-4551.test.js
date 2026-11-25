import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const usageDb = await import("@/lib/usageDb.js");

// Responses input_tokens already includes the cached part, which is only
// visible in input_tokens_details.
const USAGE = {
  input_tokens: 5000,
  input_tokens_details: { cached_tokens: 4096 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 8 },
  total_tokens: 5020,
};

function responsesStream(usage) {
  const raw = [
    'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","created_at":1700000000}}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}',
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed", usage } })}`,
    "",
  ].join("\n\n");
  return new Response(raw, { headers: { "content-type": "text/event-stream" } });
}

async function collapse(sourceFormat, usage = USAGE) {
  const result = await handleForcedSSEToJson({
    providerResponse: responsesStream(usage),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "codex",
    model: "gpt-x",
    body: { model: "gpt-x", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });
  return result.response.json();
}

describe("port(upstream) #4551: Responses usage details on a forced-stream upstream", () => {
  it("gives a Chat client cached and reasoning detail without double counting", async () => {
    const json = await collapse(FORMATS.OPENAI);
    expect(json.usage.prompt_tokens).toBe(5000);
    expect(json.usage.completion_tokens).toBe(20);
    expect(json.usage.prompt_tokens_details).toEqual({ cached_tokens: 4096 });
    expect(json.usage.completion_tokens_details).toEqual({ reasoning_tokens: 8 });
    const saved = usageDb.saveRequestUsage.mock.calls.at(-1)[0].tokens;
    expect(saved).toMatchObject({ prompt_tokens: 5000, cached_tokens: 4096, completion_tokens: 20, reasoning_tokens: 8 });
  });

  it("keeps both detail objects for a Responses client", async () => {
    const json = await collapse(FORMATS.OPENAI_RESPONSES);
    expect(json.usage.input_tokens_details).toEqual({ cached_tokens: 4096 });
    expect(json.usage.output_tokens_details).toEqual({ reasoning_tokens: 8 });
  });

  it("adds no completion detail when nothing was reasoned", async () => {
    const json = await collapse(FORMATS.OPENAI, { input_tokens: 5, output_tokens: 2, total_tokens: 7 });
    expect(json.usage).not.toHaveProperty("completion_tokens_details");
  });
});
