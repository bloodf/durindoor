import "../translator/registerAll.js";
import { describe, it, expect } from "vitest";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Adapted from OmniRoute #19006 (head 7187e64b, merge e04c0ebb): item identity is output_index.
const frame = (delta, finish = null, extra = {}) => ({
  id: "chatcmpl-idx",
  model: "test-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
});
const call = (index, id, args = "{}") => frame({
  tool_calls: [{ index, id, type: "function", function: { name: "f", arguments: args } }],
});
const usage = { usage: { prompt_tokens: 1, completion_tokens: 1 } };

function run(chunks) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  state.toolSchemas = new Map([["f", {}]]);
  const events = [];
  for (const chunk of [...chunks, null]) {
    const result = openaiToOpenAIResponsesResponse(chunk, state);
    if (result) events.push(...result);
  }
  return events;
}
const data = (events, event, type) =>
  events.filter(e => e.event === event && (!type || e.data.item?.type === type));
const indexesFor = (events, itemId) =>
  new Set(events.filter(e => (e.data.item?.id ?? e.data.item_id) === itemId).map(e => e.data.output_index));
const seqOf = events => events.map(e => e.data.sequence_number).filter(n => n !== undefined);

describe("Responses output_index stability (OmniRoute #19006)", () => {
  it("keeps each tool item on one index through announcement, deltas and completion", () => {
    const events = run([
      call(0, "call_1", '{"a":'),
      frame({ content: "hi" }),
      frame({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }),
      frame({}, "tool_calls", usage),
    ]);
    const [added] = data(events, "response.output_item.added", "function_call");
    const [done] = data(events, "response.output_item.done", "function_call");
    const itemId = added.data.item.id;
    expect(done.data.output_index).toBe(added.data.output_index);
    expect(indexesFor(events, itemId)).toEqual(new Set([added.data.output_index]));
    const deltas = events.filter(e => e.event === "response.function_call_arguments.delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every(e => e.data.output_index === added.data.output_index)).toBe(true);
    const [msg] = data(events, "response.output_item.added", "message");
    expect(msg.data.output_index).not.toBe(added.data.output_index);
  });

  it("uses a single continuation message for text after a tool turn", () => {
    const events = run([
      frame({ content: "pre" }),
      call(0, "call_1"),
      frame({ content: "a" }),
      frame({ content: "b" }),
      frame({ content: "c" }),
      frame({}, "stop", usage),
    ]);
    const messages = data(events, "response.output_item.added", "message");
    expect(messages).toHaveLength(1);
    const doneIdx = data(events, "response.output_item.done").map(e => e.data.output_index);
    expect(new Set(doneIdx).size).toBe(doneIdx.length);
    const completed = events.find(e => e.event === "response.completed");
    const texts = completed.data.response.output.filter(o => o.type === "message").map(o => o.content[0].text);
    expect(texts).toEqual(["preabc"]);
  });

  it("keeps unique ordered indexes across tool, text, tool segments with reasoning first", () => {
    const events = run([
      frame({ reasoning_content: "think" }),
      call(0, "call_1"),
      frame({ content: "abc" }),
      call(1, "call_2"),
      frame({ content: "xyz" }),
      frame({}, "stop", usage),
    ]);
    const addedIdx = data(events, "response.output_item.added").map(e => e.data.output_index);
    expect(addedIdx).toEqual([...addedIdx].sort((a, b) => a - b));
    expect(new Set(addedIdx).size).toBe(addedIdx.length);
    for (const type of ["function_call", "message", "reasoning"]) {
      for (const added of data(events, "response.output_item.added", type)) {
        const done = events.find(e => e.event === "response.output_item.done" && e.data.item?.id === added.data.item.id);
        expect(done.data.output_index).toBe(added.data.output_index);
      }
    }
    const completed = events.find(e => e.event === "response.completed").data.response.output;
    expect(completed.map(o => o.type).sort()).toEqual(["function_call", "function_call", "message", "reasoning"]);
    expect(completed.filter(o => o.type === "function_call").map(o => o.call_id)).toEqual(["call_1", "call_2"]);
    const seq = seqOf(events);
    expect(seq).toEqual(seq.map((_, i) => i + 1));
  });
});
