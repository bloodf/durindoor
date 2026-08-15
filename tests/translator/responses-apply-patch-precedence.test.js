// OmniRoute #10041: apply_patch defaults to custom framing only when undeclared.
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (delta, extra = {}) => ({ choices: [{ index: 0, delta, ...extra }] });

function run(requestBody) {
  const state = initState(FORMATS.OPENAI_RESPONSES, requestBody);
  const events = [];
  for (const current of [
    chunk({ content: "Working." }),
    chunk({ tool_calls: [{ index: 0, id: "call_function", type: "function", function: { name: "apply_patch", arguments: '{"input":"function patch"}' } }] }),
    chunk({ tool_calls: [{ index: 1, id: "call_fallback", type: "function", function: { name: "apply_patch", arguments: '{"input":"fallback patch"}' } }] }),
    chunk({}, { finish_reason: "tool_calls" }),
  ]) {
    events.push(...translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, current, state));
  }
  return events.concat(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, state));
}

describe("Responses apply_patch declaration precedence (#10041)", () => {
  it("uses function framing for declared apply_patch and custom fallback otherwise", () => {
    const declared = run({ tools: [{ type: "function", function: { name: "apply_patch" } }] });
    const declaredItems = declared.filter(({ event }) => event === "response.output_item.done");
    expect(declaredItems.map(({ data }) => [data.output_index, data.item.type, data.item.call_id])).toEqual([
      [0, "message", undefined],
      [1, "function_call", "call_function"],
      [2, "function_call", "call_fallback"],
    ]);
    expect(declared.filter(({ event }) => event === "response.custom_tool_call_input.done")).toHaveLength(0);

    const fallback = run();
    const fallbackItems = fallback.filter(({ event }) => event === "response.output_item.done");
    expect(fallbackItems.map(({ data }) => [data.output_index, data.item.type, data.item.call_id])).toEqual([
      [0, "message", undefined],
      [1, "custom_tool_call", "call_function"],
      [2, "custom_tool_call", "call_fallback"],
    ]);
    expect(fallback.filter(({ event }) => event === "response.custom_tool_call_input.done").map(({ data }) => data.input)).toEqual([
      "function patch",
      "fallback patch",
    ]);
    expect(fallback.filter(({ event }) => event === "response.function_call_arguments.done")).toHaveLength(0);
  });
});
