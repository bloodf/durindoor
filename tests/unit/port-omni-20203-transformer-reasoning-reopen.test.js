import { describe, it, expect } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const chunk = (delta, finish = null) => ({ id: "c1", choices: [{ index: 0, delta, finish_reason: finish }] });

async function run(frames) {
  const text = frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join("");
  const out = await new Response(new Response(text).body.pipeThrough(createResponsesApiTransformStream())).text();
  return out.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
}

describe("OmniRoute #20203: reasoning resumes after the answer", () => {
  it("opens a new reasoning item with its own output index", async () => {
    const events = await run([chunk({ reasoning_content: "first" }), chunk({ content: "answer" }), chunk({ reasoning_content: "second" }), chunk({}, "stop")]);
    const added = events.filter((event) => event.type === "response.output_item.added" && event.item.type === "reasoning");
    expect(new Set(added.map((event) => event.item.id)).size).toBe(2);
    expect(new Set(added.map((event) => event.output_index)).size).toBe(2);
    const output = events.at(-1).response.output;
    expect(output.map((item) => item.type)).toEqual(["reasoning", "message", "reasoning"]);
    expect(output[2].summary[0].text).toBe("second");
  });

  it("drops trailing whitespace instead of writing to the closed item", async () => {
    const events = await run([chunk({ reasoning_content: "first" }), chunk({ content: "answer" }), chunk({ reasoning_content: "\n" }), chunk({}, "stop")]);
    expect(events.filter((event) => event.type === "response.reasoning_summary_text.delta")).toHaveLength(1);
  });
});
