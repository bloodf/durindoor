// Source order must survive snapshot recovery (#1073). A Responses stream can
// deliver the delta of a later output item before the snapshot of an earlier
// one; the recovered suffix of that earlier item belongs between them, not
// after the later text. The recovered text of the shipped fixture arrived as
// "ACBD" instead of "ABCD".
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

const message = (id, text) => ({ id, type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const delta = (itemId, outputIndex, text) => ({
  type: "response.output_text.delta",
  item_id: itemId,
  output_index: outputIndex,
  content_index: 0,
  delta: text,
});
const call = (id, outputIndex) => ({
  type: "response.output_item.added",
  output_index: outputIndex,
  item: { id, type: "function_call", call_id: `call_${id}`, name: "lookup", arguments: "" },
});

/** Collect the translated chunks of a Responses event sequence. */
function collect(events, state = {}) {
  const chunks = [];
  for (const event of events) {
    const out = openaiResponsesToOpenAIResponse(event, state);
    if (!out) continue;
    chunks.push(...(Array.isArray(out) ? out : [out]));
  }
  return chunks;
}

/** The visible text of a chunk list, in the order the client receives it. */
const textOf = (chunks) => chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("");

/** The text deltas of a chunk list, without the terminal chunk that carries no text. */
const textDeltas = (chunks) => chunks
  .map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
  .filter((content) => content !== "");

describe("Responses snapshot source order", () => {
  it("keeps recovered text in source order", () => {
    const chunks = collect([
      delta("a", 0, "A"),
      delta("b", 1, "C"),
      { type: "response.completed", response: { output: [message("a", "AB"), message("b", "CD")] } },
    ]);
    expect(textDeltas(chunks)).toEqual(["A", "B", "C", "D"]);
    expect(textOf(chunks)).toBe("ABCD");
  });

  it("keeps the streamed text of a snapshot that does not extend it", () => {
    const chunks = collect([
      delta("a", 0, "A"),
      delta("b", 1, "C"),
      { type: "response.completed", response: { output: [message("a", "AB"), message("b", "XY")] } },
    ]);
    expect(textOf(chunks)).toBe("ABC");
  });

  it("does not replay a snapshot on a repeated terminal event", () => {
    const chunks = collect([
      delta("a", 0, "A"),
      delta("b", 1, "C"),
      { type: "response.completed", response: { output: [message("a", "AB"), message("b", "CD")] } },
      { type: "response.completed", response: { output: [message("a", "AB"), message("b", "CD")] } },
    ]);
    expect(textOf(chunks)).toBe("ABCD");
  });

  it("streams a single item incrementally", () => {
    const chunks = collect([
      delta("a", 0, "A"),
      delta("a", 0, "B"),
      { type: "response.completed", response: { output: [message("a", "AB")] } },
    ]);
    expect(textDeltas(chunks)).toEqual(["A", "B"]);
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("releases held text when the stream ends without a finished response", () => {
    const state = {};
    const chunks = collect([delta("a", 0, "A"), delta("b", 1, "C")], state);
    const flushed = openaiResponsesToOpenAIResponse(null, state);
    expect(textOf(flushed ? [...chunks, ...(Array.isArray(flushed) ? flushed : [flushed])] : chunks)).toBe("AC");
  });

  it("releases held text when the hold reaches its cap", () => {
    // The hold is bounded: a stream whose earlier item never finishes cannot
    // grow it without bound. Past the cap the held text is released in source
    // order instead of being dropped.
    const big = "x".repeat(200 * 1024);
    const chunks = collect([delta("a", 0, "A"), delta("b", 1, big), delta("b", 1, big)]);
    expect(textOf(chunks)).toBe(`A${big}${big}`);
  });

  it("keeps a rotated item id on the same output position", () => {
    const chunks = collect([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "a", delta: "Hel" },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "b", delta: "lo" },
      { type: "response.output_text.done", output_index: 0, content_index: 0, item_id: "c", text: "Hello!" },
    ]);
    expect(textOf(chunks)).toBe("Hello!");
  });

  it("keeps a new item that reuses an output position distinct", () => {
    const chunks = collect([
      { type: "response.output_item.done", output_index: 0, item: message("a", "First") },
      { type: "response.output_item.done", output_index: 0, item: message("b", "Second") },
    ]);
    expect(textOf(chunks)).toBe("FirstSecond");
  });

  it("keeps tool identity while the text keeps its source order", () => {
    const chunks = collect([
      delta("a", 0, "A"),
      call("fc_1", 1),
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{}" },
      delta("b", 2, "C"),
      {
        type: "response.output_item.done",
        output_index: 1,
        item: { id: "fc_1", type: "function_call", call_id: "call_fc_1", name: "lookup", arguments: "{}" },
      },
      {
        type: "response.completed",
        response: {
          output: [
            message("a", "AB"),
            { id: "fc_1", type: "function_call", call_id: "call_fc_1", name: "lookup", arguments: "{}" },
            message("b", "CD"),
          ],
        },
      },
    ]);
    expect(textOf(chunks)).toBe("ABCD");
    const toolCalls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? []);
    expect(toolCalls[0].function.name).toBe("lookup");
    expect(toolCalls[0].id).toBe("call_fc_1");
    expect(toolCalls[1].function.arguments).toBe("{}");
  });
});
