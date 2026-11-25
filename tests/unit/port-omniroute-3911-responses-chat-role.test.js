import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

const translate = (events) => {
  const state = {};
  return events.flatMap((event) => openaiResponsesToOpenAIResponse(event, state) ?? []);
};

const roles = (chunks) => chunks.map((chunk) => chunk.choices[0].delta.role);

const functionCall = { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather", arguments: '{"x":1}' };

describe("OmniRoute #3911 Responses to Chat announces the assistant role on the first delta", () => {
  it("announces the role once on a text stream", () => {
    const chunks = translate([
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: " world" },
    ]);

    expect(roles(chunks)).toEqual(["assistant", undefined]);
    expect(chunks.map((chunk) => chunk.choices[0].delta.content)).toEqual(["Hello", " world"]);
  });

  it("announces the role on the tool_call header, not on argument deltas", () => {
    const chunks = translate([
      { type: "response.output_item.added", item: { ...functionCall, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"x":1}' },
    ]);

    expect(roles(chunks)).toEqual(["assistant", undefined]);
    expect(chunks[0].choices[0].delta.tool_calls[0].function.name).toBe("get_weather");
  });

  it("announces the role on a leading reasoning delta", () => {
    const chunks = translate([
      { type: "response.reasoning_summary_text.delta", delta: "thinking" },
      { type: "response.output_text.delta", delta: "done" },
    ]);

    expect(roles(chunks)).toEqual(["assistant", undefined]);
  });

  it("announces the role only on the first of several chunks from one done-only tool item", () => {
    const chunks = translate([{ type: "response.output_item.done", output_index: 0, item: functionCall }]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(roles(chunks)).toEqual(["assistant", ...chunks.slice(1).map(() => undefined)]);
  });

  it("announces the role on the first chunk recovered from a completed snapshot", () => {
    const chunks = translate([
      { type: "response.completed", response: { status: "completed", output: [functionCall] } },
    ]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(roles(chunks)).toEqual(["assistant", ...chunks.slice(1).map(() => undefined)]);
  });

  it("emits exactly one role through the translated SSE stream", async () => {
    const frames = [
      { type: "response.created", response: { id: "resp_1", model: "m" } },
      { type: "response.output_text.delta", output_index: 0, delta: "Hello" },
      { type: "response.output_text.delta", output_index: 0, delta: " world" },
      { type: "response.completed", response: { status: "completed" } },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const upstream = new Response(frames).body;
    const stream = createSSETransformStreamWithLogger("openai-responses", "openai", "codex", null, null, "m", "c", { messages: [] });

    const text = await new Response(upstream.pipeThrough(stream)).text();
    const chunks = text.split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));

    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "Hello" });
    expect(roles(chunks).filter(Boolean)).toEqual(["assistant"]);
  });
});
