import "../translator/registerAll.js";
import { describe, it, expect } from "vitest";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const chunk = { id: "chatcmpl-test", model: "test", choices: [{ index: 0, delta: {
  content: "<think>plan", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }]
}, finish_reason: "tool_calls" }] };

describe("mixed reasoning and tool calls", () => {
  it("preserves the tool call in the translator", () => {
    const events = openaiToOpenAIResponsesResponse(chunk, initState(FORMATS.OPENAI_RESPONSES));
    expect(events.some(e => e.event === "response.output_item.added" && e.data.item?.call_id === "call_1")).toBe(true);
  });
  it("preserves the tool call in the stream transformer", async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)); c.close(); } });
    const output = await new Response(stream.pipeThrough(createResponsesApiTransformStream())).text();
    expect(output).toContain('"call_id":"call_1"');
  });
});

describe("Responses summaries with rotated reasoning IDs", () => {
  it("deduplicates a streamed summary and replays a snapshot for a different output item", () => {
    const state = initState(FORMATS.CLAUDE);
    const convert = (type, data) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, { type, ...data }, state);
    const done = (output_index, id, text) => convert("response.output_item.done", {
      output_index, item: { id, type: "reasoning", summary: [{ type: "summary_text", text }] },
    });
    const events = [
      ...convert("response.reasoning_summary_text.delta", { output_index: 0, item_id: "initial", delta: "Plan" }),
      ...done(0, "rotated", "Plan"),
      ...done(1, "other", "Check"),
      ...convert("response.output_item.added", {
        output_index: 2, item: { id: "tool", type: "function_call", call_id: "call_1", name: "lookup" },
      }),
      ...convert("response.completed", { response: {} }),
    ];
    expect(events.filter(event => event.delta?.type === "thinking_delta").map(event => event.delta.thinking))
      .toEqual(["Plan", "Check"]);
    expect(events.some(event => event.content_block?.type === "tool_use")).toBe(true);
    expect(events.some(event => event.delta?.type === "text_delta")).toBe(false);
  });
});
