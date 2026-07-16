// OmniRoute #6937: OpenAI → Responses tool-call shape.
// Covers function_call and custom_tool_call items, output_index offset past a
// preceding reasoning item, status fields, and fragmented arguments.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (delta, extra = {}) => ({
  choices: [{ index: 0, delta, ...extra }],
});

function run(chunks) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  const events = [];
  for (const c of chunks) {
    events.push(...translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, c, state));
  }
  // flush
  events.push(...translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, state));
  return events;
}

const byType = (events, t) => events.filter((e) => e.event === t);

describe("OpenAI → Responses tool-call shape (#6937)", () => {
  it("streams a function tool call with id/name/arguments, status fields and output_index 0", () => {
    const events = run([
      chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"city\":" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "\"Paris\"}" } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ]);

    const added = byType(events, "response.output_item.added");
    expect(added).toHaveLength(1);
    expect(added[0].data.output_index).toBe(0);
    expect(added[0].data.item).toMatchObject({
      type: "function_call",
      call_id: "call_1",
      name: "get_weather",
      arguments: "",
      status: "in_progress",
    });

    const deltas = byType(events, "response.function_call_arguments.delta");
    expect(deltas.map((d) => d.data.delta).join("")).toBe('{"city":"Paris"}');
    expect(deltas.every((d) => d.data.item_id === "fc_call_1" && d.data.output_index === 0)).toBe(true);

    const argsDone = byType(events, "response.function_call_arguments.done");
    expect(argsDone).toHaveLength(1);
    expect(argsDone[0].data).toMatchObject({ item_id: "fc_call_1", output_index: 0, arguments: '{"city":"Paris"}' });

    const itemDone = byType(events, "response.output_item.done");
    expect(itemDone).toHaveLength(1);
    expect(itemDone[0].data.item).toMatchObject({
      type: "function_call",
      call_id: "call_1",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
      status: "completed",
    });
  });

  it("preserves normal text content alongside tool-call events", () => {
    const events = run([
      chunk({ content: "Hello " }),
      chunk({ content: "world" }),
      chunk({}, { finish_reason: "stop" }),
    ]);

    const textDeltas = byType(events, "response.output_text.delta");
    expect(textDeltas.map((d) => d.data.delta).join("")).toBe("Hello world");

    const itemDone = byType(events, "response.output_item.done");
    expect(itemDone).toHaveLength(1);
    expect(itemDone[0].data.item.type).toBe("message");
    expect(itemDone[0].data.item.content[0].text).toBe("Hello world");
  });

  it("offsets tool-call output_index past a preceding reasoning item", () => {
    const events = run([
      chunk({ content: "<think>let me think</think>" }),
      chunk({ tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "search", arguments: "{}" } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ]);

    const added = byType(events, "response.output_item.added");
    // reasoning item at 0, function_call shifted to 1 — no collision at 0.
    expect(added[0].data.item.type).toBe("reasoning");
    expect(added[0].data.output_index).toBe(0);
    const fcAdded = added.find((e) => e.data.item.type === "function_call");
    expect(fcAdded.data.output_index).toBe(1);

    const fcDone = byType(events, "response.output_item.done").find((e) => e.data.item.type === "function_call");
    expect(fcDone.data.output_index).toBe(1);
    expect(fcDone.data.item.status).toBe("completed");
  });

  it("keeps text and tool call in order in a mixed stream (text → tool call)", () => {
    const events = run([
      chunk({ content: "Here is the result." }),
      chunk({ tool_calls: [{ index: 0, id: "call_m", type: "function", function: { name: "save", arguments: "{\"ok\":true}" } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ]);

    // message closes before the tool call; text preserved exactly.
    const done = byType(events, "response.output_item.done");
    expect(done.map((d) => d.data.item.type)).toEqual(["message", "function_call"]);
    expect(done[0].data.item.content[0].text).toBe("Here is the result.");
    expect(done[1].data.item).toMatchObject({
      type: "function_call",
      call_id: "call_m",
      name: "save",
      arguments: '{"ok":true}',
      status: "completed",
    });
    expect(done[1].data.output_index).toBe(0);
  });

  it("emits apply_patch as custom_tool_call with custom_tool_call_input events", () => {
    const patch = "*** Begin Patch\n*** Update File: a.js\n*** End Patch";
    const events = run([
      chunk({ tool_calls: [{ index: 0, id: "call_p", type: "function", function: { name: "apply_patch", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ input: patch }) } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ]);

    const added = byType(events, "response.output_item.added");
    expect(added).toHaveLength(1);
    expect(added[0].data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_p",
      name: "apply_patch",
      input: "",
      status: "in_progress",
    });

    const inputDeltas = byType(events, "response.custom_tool_call_input.delta");
    expect(inputDeltas).toHaveLength(1);
    expect(inputDeltas[0].data.item_id).toBe("fc_call_p");

    const inputDone = byType(events, "response.custom_tool_call_input.done");
    expect(inputDone).toHaveLength(1);
    expect(inputDone[0].data.input).toBe(patch);

    const itemDone = byType(events, "response.output_item.done");
    expect(itemDone).toHaveLength(1);
    expect(itemDone[0].data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_p",
      name: "apply_patch",
      input: patch,
      status: "completed",
    });
  });
});
