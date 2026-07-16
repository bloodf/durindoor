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

function run(chunks, requestBody = null) {
  const state = initState(FORMATS.OPENAI_RESPONSES, requestBody);
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
    expect(done[1].data.output_index).toBe(1);
  });

  it("uses declared tool type from request body instead of name heuristic", () => {
    const requestBody = {
      tools: [
        { type: "function", function: { name: "apply_patch" } },
        { type: "custom", function: { name: "custom_tool" } }
      ]
    };

    // apply_patch declared as function => function_call, not custom_tool_call
    const events = run([
      chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "apply_patch", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ input: "patch" }) } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ], requestBody);

    const added = byType(events, "response.output_item.added");
    expect(added[0].data.item.type).toBe("function_call");
    expect(byType(events, "response.function_call_arguments.delta").length).toBe(1);
    expect(byType(events, "response.custom_tool_call_input.delta").length).toBe(0);

    // custom_tool declared as custom => custom_tool_call, despite name not apply_patch
    const customEvents = run([
      chunk({ tool_calls: [{ index: 0, id: "call_c", type: "function", function: { name: "custom_tool", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ input: "custom" }) } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ], requestBody);

    expect(byType(customEvents, "response.output_item.added")[0].data.item.type).toBe("custom_tool_call");
    expect(byType(customEvents, "response.custom_tool_call_input.delta").map(d => d.data.delta).join("")).toBe("custom");
    expect(byType(customEvents, "response.custom_tool_call_input.done")[0].data.input).toBe("custom");
  });

  it("defers output_item.added until tool name arrives after id", () => {
    const patch = "patch text";
    const requestBody = { tools: [{ type: "custom", function: { name: "apply_patch" } }] };
    const events = run([
      chunk({ tool_calls: [{ index: 0, id: "call_late", type: "function", function: { arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ input: patch }) } }] }),
      chunk({ tool_calls: [{ index: 0, function: { name: "apply_patch" } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ], requestBody);

    const added = byType(events, "response.output_item.added");
    expect(added).toHaveLength(1);
    expect(added[0].data.item.type).toBe("custom_tool_call");
    expect(added[0].data.item.name).toBe("apply_patch");
    expect(added[0].data.item.input).toBe("");

    // Buffered argument delta replays after added
    const inputDeltas = byType(events, "response.custom_tool_call_input.delta");
    expect(inputDeltas).toHaveLength(1);
    expect(inputDeltas[0].data.delta).toBe(patch);
  });

  it("concatenated custom_tool_call_input deltas equal final done input", () => {
    const inputA = '{"input":"*** Begin Patch';
    const requestBody = { tools: [{ type: "custom", function: { name: "apply_patch" } }] };
    const inputB = '\\n*** End Patch"}';
    const events = run([
      chunk({ tool_calls: [{ index: 0, id: "call_frag", type: "function", function: { name: "apply_patch", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: inputA } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: inputB } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ], requestBody);

    const deltas = byType(events, "response.custom_tool_call_input.delta");
    const done = byType(events, "response.custom_tool_call_input.done");
    expect(deltas.map((d) => d.data.delta).join("")).toBe(done[0].data.input);
  });

  it("allocates monotonic indexes for reasoning, text, and tool calls", () => {
    const events = run([
      chunk({ content: "<think>think</think>" }),
      chunk({ content: "text" }),
      chunk({ tool_calls: [{ index: 0, id: "call_t", type: "function", function: { name: "noop", arguments: "{}" } }] }),
      chunk({}, { finish_reason: "tool_calls" }),
    ]);

    const done = byType(events, "response.output_item.done");
    expect(done.map((d) => d.data.output_index)).toEqual([0, 1, 2]);
    expect(done.map((d) => d.data.item.type)).toEqual(["reasoning", "message", "function_call"]);
  });
});
