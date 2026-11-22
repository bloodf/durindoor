// decolua/9router#4380: createResponsesApiTransformStream sent response.completed
// without the output items it had already streamed, so clients that build the
// final result from the terminal event (Copilot CLI, SDK final-response helpers)
// saw an empty turn.
import { describe, expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const encoder = new TextEncoder();
const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const chunk = (delta, finish = null) => sse({ id: "chatcmpl-1", choices: [{ index: 0, delta, finish_reason: finish }] });

async function run(chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  const reader = source.pipeThrough(createResponsesApiTransformStream()).getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
}

describe("response.completed output (#4380)", () => {
  it("repeats the streamed message item", async () => {
    const events = await run([chunk({ role: "assistant", content: "" }), chunk({ content: "Hello" }), chunk({}, "stop"), "data: [DONE]\n\n"]);
    const done = events.filter((e) => e.type === "response.output_item.done").map((e) => e.item);
    const completed = events.find((e) => e.type === "response.completed").response;
    expect(done).toHaveLength(1);
    expect(completed.output).toEqual(done);
    expect(completed.output[0]).toMatchObject({ type: "message", role: "assistant" });
    expect(completed.output[0].content[0].text).toBe("Hello");
  });

  it("includes the function_call item", async () => {
    const events = await run([
      chunk({ tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "search", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":"hi"}' } }] }),
      chunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ]);
    const output = events.find((e) => e.type === "response.completed").response.output;
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: "function_call", name: "search", call_id: "call_abc", arguments: '{"q":"hi"}' });
  });

  it("orders items by output_index", async () => {
    const events = await run([
      chunk({ reasoning_content: "thinking" }),
      chunk({ content: "answer" }),
      chunk({}, "stop"),
      "data: [DONE]\n\n",
    ]);
    const output = events.find((e) => e.type === "response.completed").response.output;
    expect(output.map((item) => item.type)).toEqual(["reasoning", "message"]);
  });
});
