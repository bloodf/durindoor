// #1436: a Responses-upstream custom_tool_call must reach a Chat client as the
// Chat custom tool-call shape when the client declared the custom tool, and as
// a function call with JSON `{input}` arguments otherwise. Function calls are
// unchanged.
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

const RAW = "*** Begin Patch\n*** Update File: a.txt\n-old\n+new\n*** End Patch";
const customDecl = { type: "custom", custom: { name: "apply_patch", description: "patch" } };
const fnDecl = { type: "function", function: { name: "get_weather", parameters: { type: "object" } } };

function stream(tools, events) {
  const state = initState(FORMATS.OPENAI, { messages: [], tools });
  return events.flatMap(([event, data]) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, { event, data }, state) || [])
    .filter(Boolean)
    .flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
}

const customEvents = (withDeltas = true) => [
  ["response.created", { type: "response.created", response: { id: "resp_1" } }],
  ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "apply_patch", input: "" } }],
  ...(withDeltas ? [
    ["response.custom_tool_call_input.delta", { type: "response.custom_tool_call_input.delta", item_id: "ctc_1", delta: RAW.slice(0, 10) }],
    ["response.custom_tool_call_input.delta", { type: "response.custom_tool_call_input.delta", item_id: "ctc_1", delta: RAW.slice(10) }],
  ] : []),
  ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "apply_patch", input: RAW } }],
];

describe("#1436 Responses custom_tool_call → Chat stream", () => {
  it.each([[true], [false]])("emits the Chat custom shape for a declared custom tool (deltas: %s)", (withDeltas) => {
    const calls = stream([customDecl], customEvents(withDeltas));
    expect(calls[0]).toEqual({ index: 0, id: "call_1", type: "custom", custom: { name: "apply_patch", input: "" } });
    expect(calls.every((call) => !call.function)).toBe(true);
    expect(calls.map((call) => call.custom.input).join("")).toBe(RAW);
  });

  it.each([[true], [false]])("wraps raw input as JSON {input} for an undeclared custom tool (deltas: %s)", (withDeltas) => {
    const calls = stream([fnDecl], customEvents(withDeltas));
    expect(calls[0]).toMatchObject({ index: 0, id: "call_1", type: "function", function: { name: "apply_patch", arguments: "" } });
    const args = calls.map((call) => call.function.arguments).join("");
    expect(JSON.parse(args)).toEqual({ input: RAW });
  });

  it("keeps function calls unchanged", () => {
    const calls = stream([fnDecl, customDecl], [
      ["response.created", { type: "response.created", response: { id: "resp_1" } }],
      ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_f", name: "get_weather", arguments: "" } }],
      ["response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{\"city\":\"x\"}" }],
      ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_f", name: "get_weather", arguments: "{\"city\":\"x\"}" } }],
    ]);
    expect(calls).toEqual([
      { index: 0, id: "call_f", type: "function", function: { name: "get_weather", arguments: "" } },
      { index: 0, function: { arguments: "{\"city\":\"x\"}" } },
    ]);
  });
});

describe("#1436 Responses custom_tool_call → Chat non-stream", () => {
  const body = {
    id: "resp_1",
    object: "response",
    status: "completed",
    output: [
      { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "apply_patch", input: RAW },
      { type: "function_call", id: "fc_1", call_id: "call_f", name: "get_weather", arguments: "{\"city\":\"x\"}" },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  const project = (tools) => translateNonStreamingResponse(body, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, { requestBody: { messages: [], tools } })
    .choices[0].message.tool_calls;

  it("emits the Chat custom shape for a declared custom tool and keeps the function call", () => {
    expect(project([customDecl, fnDecl])).toEqual([
      { id: "call_1", type: "custom", custom: { name: "apply_patch", input: RAW } },
      { id: "call_f", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"x\"}" } },
    ]);
  });

  it("keeps JSON {input} function arguments when the client did not declare the custom tool", () => {
    const [custom] = project([fnDecl]);
    expect(custom.type).toBe("function");
    expect(JSON.parse(custom.function.arguments)).toEqual({ input: RAW });
  });
});

describe("#1436 review follow-ups", () => {
  const added = (id, callId, name) => ["response.output_item.added", { type: "response.output_item.added", item: { type: "custom_tool_call", id, call_id: callId, name, input: "" } }];
  const delta = (id, text) => ["response.custom_tool_call_input.delta", { type: "response.custom_tool_call_input.delta", item_id: id, delta: text }];
  const done = (id, callId, name, input) => ["response.output_item.done", { type: "response.output_item.done", item: { type: "custom_tool_call", id, call_id: callId, name, input } }];

  it("keeps two interleaved parallel custom calls apart (declared + wrapped)", () => {
    const calls = stream([customDecl, fnDecl], [
      ["response.created", { type: "response.created", response: { id: "resp_1" } }],
      added("ctc_a", "call_a", "apply_patch"),
      added("ctc_b", "call_b", "shell"),
      delta("ctc_b", "ls "),
      delta("ctc_a", "*** Begin"),
      delta("ctc_b", "-la"),
      delta("ctc_a", " Patch"),
      done("ctc_b", "call_b", "shell", "ls -la"),
      done("ctc_a", "call_a", "apply_patch", "*** Begin Patch"),
    ]);
    const byIndex = (i) => calls.filter((call) => call.index === i);
    expect(byIndex(0)[0]).toMatchObject({ id: "call_a", type: "custom", custom: { name: "apply_patch" } });
    expect(byIndex(0).map((call) => call.custom.input).join("")).toBe("*** Begin Patch");
    expect(byIndex(1)[0]).toMatchObject({ id: "call_b", type: "function", function: { name: "shell" } });
    expect(JSON.parse(byIndex(1).map((call) => call.function.arguments).join(""))).toEqual({ input: "ls -la" });
  });

  it.each([
    ["response.incomplete", { type: "response.incomplete", response: { status: "incomplete" } }],
    ["response.completed", { type: "response.completed", response: { status: "completed" } }],
    ["response.failed", { type: "response.failed", response: { status: "failed", error: { message: "boom" } } }],
  ])("flushes buffered wrapped input on %s when the item never finished", (event, data) => {
    const state = initState(FORMATS.OPENAI, { messages: [], tools: [fnDecl] });
    const chunks = [
      ["response.created", { type: "response.created", response: { id: "resp_1" } }],
      added("ctc_b", "call_b", "shell"),
      delta("ctc_b", "ls -la"),
      [event, data],
    ].flatMap(([e, d]) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, { event: e, data: d }, state) || []).filter(Boolean);
    const args = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []).map((call) => call.function.arguments).join("");
    expect(JSON.parse(args)).toEqual({ input: "ls -la" });
    // The arguments arrive before the terminal chunk.
    const finishAt = chunks.findIndex((chunk) => chunk.choices?.[0]?.finish_reason);
    const argsAt = chunks.findIndex((chunk) => chunk.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments);
    expect(argsAt).toBeLessThan(finishAt);
  });

  it("clears custom-tool framing on response.created", () => {
    const state = initState(FORMATS.OPENAI, { messages: [], tools: [fnDecl] });
    for (const [e, d] of [["response.created", { type: "response.created", response: { id: "r1" } }], added("ctc_b", "call_b", "shell"), delta("ctc_b", "x")]) {
      translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, { event: e, data: d }, state);
    }
    translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, { event: "response.created", data: { type: "response.created", response: { id: "r2" } } }, state);
    expect(state.respCustomToolKinds.size).toBe(0);
    expect(state.respCustomToolInput.size).toBe(0);
  });

  it("never uses the Chat custom shape for a Claude client that declares a custom-typed tool", () => {
    const state = initState(FORMATS.CLAUDE, { messages: [], tools: [{ type: "custom", name: "apply_patch", input_schema: { type: "object" } }] });
    expect(state.chatCustomToolNames.size).toBe(0);
    const events = [...customEvents(true), ["response.completed", { type: "response.completed", response: { status: "completed" } }]]
      .flatMap(([event, data]) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, { event, data }, state) || [])
      .concat(translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, null, state) || [])
      .filter(Boolean);
    const toolStart = events.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use");
    expect(toolStart).toBeDefined();
    expect(JSON.stringify(events)).not.toContain("\"custom\":");
    const json = events.filter((event) => event.delta?.type === "input_json_delta").map((event) => event.delta.partial_json).join("");
    expect(JSON.parse(json)).toEqual({ input: RAW });
  });
});
