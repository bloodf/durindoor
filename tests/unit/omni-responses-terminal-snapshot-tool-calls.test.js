import { describe, expect, it } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const items = [
  { type: "function_call", id: "fc_a", call_id: "call_a", name: "first", arguments: '{"a":1}' },
  { type: "function_call", id: "fc_b", call_id: "call_b", name: "second", arguments: '{"b":2}' },
];
const terminal = (output) => ({ type: "response.completed", response: { status: "completed", output, usage: { input_tokens: 3, output_tokens: 2 } } });
const mixed = [
  { type: "response.output_item.added", output_index: 0, item: items[0] },
  { type: "response.function_call_arguments.delta", item_id: "fc_a", delta: '{"a":' },
  { type: "response.function_call_arguments.delta", item_id: "fc_a", delta: '1}' },
  { type: "response.output_item.done", output_index: 0, item: items[0] },
  terminal(items),
];
const flatten = (value) => value ? (Array.isArray(value) ? value : [value]) : [];
function direct(events) {
  const state = initState(FORMATS.OPENAI);
  return events.flatMap((event) => flatten(openaiResponsesToOpenAIResponse(event, state)));
}
async function stream(events) {
  const encoder = new TextEncoder();
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n"));
    controller.close();
  } });
  const output = source.pipeThrough(createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "test", null, null, "test-model", null, {}, null, null, "off", null, {}));
  let text = "";
  for await (const chunk of output) text += new TextDecoder().decode(chunk);
  return text.split(/\r?\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).filter((value) => value && value !== "[DONE]").map(JSON.parse);
}
function verify(chunks, expected) {
  const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
  expect(calls.filter((call) => call.id).map((call) => call.id)).toEqual(expected.map((item) => item.call_id));
  for (const [index, item] of expected.entries()) {
    const parts = calls.filter((call) => call.index === index);
    expect(parts.filter((call) => call.id)).toHaveLength(1);
    expect(parts[0].function.name).toBe(item.name);
    expect(parts.map((call) => call.function?.arguments || "").join("")).toBe(item.arguments);
  }
  expect(chunks.filter((chunk) => chunk.choices?.[0]?.finish_reason).map((chunk) => chunk.choices[0].finish_reason)).toEqual(["tool_calls"]);
}
describe("Responses terminal function snapshots", () => {
  for (const [name, translate] of [["direct", direct], ["stream", stream]]) {
    it(`${name} recovers a terminal-only call`, async () => verify(await translate([terminal([items[0]])]), [items[0]]));
    it(`${name} preserves mixed call order without replay`, async () => verify(await translate(mixed), items));
    it(`${name} does not replay done-only calls`, async () => verify(await translate([{ type: "response.output_item.done", output_index: 0, item: items[0] }, terminal([items[0]])]), [items[0]]));
    it(`${name} recovers a distinct anonymous snapshot call`, async () => {
      const second = { type: "function_call", name: "second", arguments: '{"b":2}' };
      const chunks = await translate([...mixed.slice(0, -1), terminal([items[0], second])]);
      const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
      const headers = calls.filter((call) => call.id);
      expect(headers).toHaveLength(2);
      expect(headers[0].id).toBe("call_a");
      expect(headers[1].id).toBeTruthy();
      expect(headers[1].id).not.toBe(headers[0].id);
      verify(chunks, [items[0], { ...second, call_id: headers[1].id }]);
    });
    it(`${name} does not replay an anonymous call at the same output index`, async () => {
      const item = { type: "function_call", name: "first", arguments: '{"a":1}' };
      const chunks = await translate([{ type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item }, terminal([item])]);
      const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
      const headers = calls.filter((call) => call.id);
      expect(headers).toHaveLength(1);
      verify(chunks, [{ ...item, call_id: headers[0].id }]);
    });
  }
  it("does not turn incomplete or failed terminals into successful tool calls", () => {
    const incomplete = direct([{ type: "response.done", response: { status: "incomplete", output: items } }]);
    expect(incomplete.at(-1).choices[0].finish_reason).toBe("length");
    const failed = direct([{ type: "response.done", response: { status: "failed", output: items, error: { message: "failed" } } }]);
    expect(failed[0].choices[0].delta.content).toContain("[Error]");
    expect(failed.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || [])).toHaveLength(0);
  });
});
