import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const created = { type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } };
const reasoningItem = { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Checked the input." }] };
const completed = (output) => ({ type: "response.completed", response: { id: "resp_1", status: "completed", output, usage: { input_tokens: 1, output_tokens: 1 } } });
const delta = (identity) => ({ type: "response.reasoning_summary_text.delta", delta: "Checked the input.", ...identity });

function reasoning(events) {
  const state = initState(FORMATS.OPENAI);
  return [...events, null]
    .flatMap((event) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, structuredClone(event), state) || [])
    .map((chunk) => chunk.choices?.[0]?.delta?.reasoning_content)
    .filter(Boolean);
}

describe("OmniRoute #21234 (c7d5d8f72614): terminal reasoning summaries", () => {
  it("emits a summary that only the completed snapshot carries", () => {
    expect(reasoning([created, completed([reasoningItem])])).toEqual(["Checked the input."]);
  });

  it.each([
    ["item id", { item_id: "rs_1" }],
    ["output index", { output_index: 0 }],
    ["no identity", {}],
  ])("does not repeat a summary already streamed with %s", (_name, identity) => {
    expect(reasoning([created, delta(identity), completed([reasoningItem])])).toEqual(["Checked the input."]);
  });

  it("does not repeat a summary already sent by output_item.done", () => {
    const done = { type: "response.output_item.done", output_index: 0, item: reasoningItem };
    expect(reasoning([created, done, completed([reasoningItem])])).toEqual(["Checked the input."]);
  });

  it("separates two summaries found only in the completed snapshot", () => {
    const second = { type: "reasoning", id: "rs_2", summary: [{ type: "summary_text", text: "Applied it." }] };
    expect(reasoning([created, completed([reasoningItem, second])])).toEqual(["Checked the input.", "\n\nApplied it."]);
  });
});
