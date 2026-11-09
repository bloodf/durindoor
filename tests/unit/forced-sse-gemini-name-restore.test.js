import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const sse = (frames) => frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

const responsesRaw = sse([
  ["response.created", { response: { id: "r", created_at: 1 } }],
  ["response.output_item.done", { output_index: 0, item: { type: "function_call", id: "fc1", call_id: "c1", name: "ns_search", arguments: "{}" } }],
  ["response.completed", { response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
]);

const chatRaw = [
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "ns_search", arguments: "{}" } }] }, finish_reason: null }] },
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
].map((c) => `data: ${JSON.stringify(c)}`).concat("data: [DONE]", "").join("\n\n");

const run = async (sourceFormat, targetFormat, raw) => {
  const result = await handleForcedSSEToJson({
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat, targetFormat, provider: "openai", model: "m",
    body: { model: "m", stream: false }, stream: true, translatedBody: null, finalBody: null,
    requestStartTime: Date.now(), connectionId: "c", apiKey: null,
    clientRawRequest: { endpoint: "/v1beta/models/m:generateContent" },
    onRequestSuccess: vi.fn(async () => {}), trackDone: vi.fn(), appendLog: vi.fn(),
    log: { line: vi.fn(), debug: vi.fn() }, usageEventId: "e", terminalProvenance: "upstream",
    toolNameMap: new Map([["ns_search", "ns.search"]]),
  });
  expect(result.success).toBe(true);
  const json = await result.response.json();
  return (json.response ?? json).candidates?.[0]?.content?.parts?.map((p) => p.functionCall?.name).filter(Boolean)
    ?? json.choices?.[0]?.message?.tool_calls?.map((t) => t.function.name);
};

describe("forced SSE to JSON restores request-side aliases for Gemini clients", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([["GEMINI", FORMATS.GEMINI], ["GEMINI_CLI", FORMATS.GEMINI_CLI]])("Responses upstream, %s client", async (_l, source) => {
    expect(await run(source, FORMATS.OPENAI_RESPONSES, responsesRaw)).toEqual(["ns.search"]);
  });

  it.each([["GEMINI", FORMATS.GEMINI], ["GEMINI_CLI", FORMATS.GEMINI_CLI]])("Chat upstream, %s client", async (_l, source) => {
    expect(await run(source, FORMATS.OPENAI, chatRaw)).toEqual(["ns.search"]);
  });
});
