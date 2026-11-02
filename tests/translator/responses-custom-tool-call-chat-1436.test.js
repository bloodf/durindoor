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
