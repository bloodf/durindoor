import { describe, expect, it } from "vitest";

import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const chunk = (delta, finishReason = null) => ({
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

describe("Responses API legacy transformer output_index allocation", () => {
  it("does not collide a tool call's output_index with a preceding reasoning item", async () => {
    const stream = createResponsesApiTransformStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let output = "";
    const reading = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
    })();

    for (const value of [
      chunk({ reasoning_content: "thinking..." }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] }),
      chunk({}, "tool_calls"),
    ]) {
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    }
    await writer.close();
    await reading;

    const events = [...output.matchAll(/event: (\S+)\ndata: (.*)\n/g)]
      .map(([, event, data]) => ({ event, data: JSON.parse(data) }));

    const reasoningAdded = events.find((e) => e.event === "response.output_item.added" && e.data.item.type === "reasoning");
    const toolCallAdded = events.find((e) => e.event === "response.output_item.added" && e.data.item.type === "function_call");

    expect(reasoningAdded.data.output_index).toBe(0);
    // Tool call arrives on the same raw tool_calls[].index (0) as the reasoning item's
    // choice index, but must be allocated a distinct output_index slot.
    expect(toolCallAdded.data.output_index).not.toBe(reasoningAdded.data.output_index);

    const argsDelta = events.find((e) => e.event === "response.function_call_arguments.delta");
    const argsDone = events.find((e) => e.event === "response.function_call_arguments.done");
    const itemDone = events.find((e) => e.event === "response.output_item.done" && e.data.item.type === "function_call");

    // Every event for the tool call must share the same allocated output_index.
    expect(argsDelta.data.output_index).toBe(toolCallAdded.data.output_index);
    expect(argsDone.data.output_index).toBe(toolCallAdded.data.output_index);
    expect(itemDone.data.output_index).toBe(toolCallAdded.data.output_index);
  });
});
