import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const sse = (events) => events.map((data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const completed = (extra = {}) => ({
  type: "response.completed",
  response: { id: "resp_1", status: "completed", usage: { input_tokens: 15, output_tokens: 8, total_tokens: 23 }, ...extra },
});
const added = (output_index, item) => ({ type: "response.output_item.added", output_index, item });

const DELTA_ONLY = sse([
  added(0, { id: "rs_0", type: "reasoning", summary: [] }),
  { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "plan" },
  added(1, { id: "msg_1", type: "message", role: "assistant", content: [] }),
  { type: "response.output_text.delta", output_index: 1, delta: "Hel" },
  { type: "response.output_text.delta", item_id: "msg_1", delta: "lo" },
  added(2, { id: "fc_2", type: "function_call", call_id: "call_1", name: "read_file", arguments: "" }),
  { type: "response.function_call_arguments.delta", item_id: "fc_2", delta: '{"path":"/x"}' },
  completed(),
]);

describe("upstream 9router #3843: non-stream Responses upstream that only sends deltas", () => {
  it("returns text, reasoning, the tool call and usage to a Claude JSON client", async () => {
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(DELTA_ONLY, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-5-codex",
      body: { model: "gpt-5-codex", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "conn",
      clientRawRequest: { endpoint: "/v1/messages" },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.content).toEqual([
      { type: "thinking", thinking: "plan" },
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "call_1", name: "read_file", input: { path: "/x" } },
    ]);
    expect(json.stop_reason).toBe("tool_use");
    expect(json.usage).toMatchObject({ input_tokens: 15, output_tokens: 8 });
  });

  it("keeps finished items authoritative over accumulated deltas", async () => {
    const final = { id: "msg_0", type: "message", role: "assistant", content: [{ type: "output_text", text: "final" }] };
    const out = await convertResponsesStreamToJson(new Response(sse([
      { type: "response.output_text.delta", output_index: 0, delta: "draft" },
      completed({ output: [final] }),
    ])).body);

    expect(out.output).toEqual([final]);
  });

  it("does not rebuild output for a stream without a successful terminal", async () => {
    const out = await convertResponsesStreamToJson(new Response(sse([
      { type: "response.output_text.delta", output_index: 0, delta: "partial" },
    ])).body);

    expect(out.status).toBe("failed");
    expect(out.output).toEqual([]);
  });
});
