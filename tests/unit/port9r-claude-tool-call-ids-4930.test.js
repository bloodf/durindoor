// Port of decolua/9router#4930: a Claude tool_use block announces its id once;
// argument deltas carry only the index, because SDKs concatenate string fields.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const startTool = (index, id) => ({
  type: "content_block_start", index,
  content_block: { type: "tool_use", id, name: "get_weather", input: {} },
});
const argsDelta = (index, partial_json) => ({
  type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json },
});

const events = [
  { type: "message_start", message: { id: "msg_tools", model: "claude-opus-5" } },
  startTool(0, "toolu_paris"),
  argsDelta(0, '{"city":'),
  argsDelta(0, '"Paris"}'),
  { type: "content_block_stop", index: 0 },
  startTool(1, "toolu_seoul"),
  argsDelta(1, '{"city":"Seoul"}'),
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
];

function translate(clientFormat) {
  const state = initState(clientFormat);
  // Serialize each chunk before the next event arrives, as the wire does.
  return [...events, null].flatMap((event) =>
    JSON.parse(JSON.stringify(translateResponse(FORMATS.CLAUDE, clientFormat, structuredClone(event), state) || [])));
}

describe("port decolua/9router#4930 - Claude streaming tool-call ids", () => {
  it("keeps ids intact for a client that concatenates streamed string fields", () => {
    const calls = [];
    for (const chunk of translate(FORMATS.OPENAI)) {
      for (const delta of chunk.choices?.[0]?.delta?.tool_calls || []) {
        const call = (calls[delta.index] ??= { id: "", name: "", arguments: "" });
        call.id += delta.id || "";
        call.name += delta.function?.name || "";
        call.arguments += delta.function?.arguments || "";
      }
    }
    expect(calls).toEqual([
      { id: "toolu_paris", name: "get_weather", arguments: '{"city":"Paris"}' },
      { id: "toolu_seoul", name: "get_weather", arguments: '{"city":"Seoul"}' },
    ]);
  });

  it("keeps ids and complete arguments through the Responses pivot", () => {
    const done = translate(FORMATS.OPENAI_RESPONSES)
      .map((event) => event.data)
      .filter((event) => event.type === "response.output_item.done" && event.item.type === "function_call")
      .map(({ item }) => ({ call_id: item.call_id, arguments: item.arguments }));
    expect(done).toEqual([
      { call_id: "toolu_paris", arguments: '{"city":"Paris"}' },
      { call_id: "toolu_seoul", arguments: '{"city":"Seoul"}' },
    ]);
  });
});
