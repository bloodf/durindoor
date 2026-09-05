import { describe, expect, it } from "vitest";

import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

function toolCalls(event, state) {
  return openaiResponsesToOpenAIResponse(event, state)?.choices[0]?.delta?.tool_calls ?? [];
}

describe("Responses parallel tool calls", () => {
  it("keeps interleaved argument deltas on each call's allocated index", () => {
    const state = {};
    const indices = new Map();
    const argumentsByIndex = new Map();
    const events = [
      { type: "response.output_item.added", item: { type: "function_call", id: "fc_001", call_id: "call_a", name: "read" } },
      { type: "response.output_item.added", item: { type: "function_call", id: "fc_002", call_id: "call_b", name: "read" } },
      { type: "response.output_item.added", item: { type: "function_call", id: "fc_003", call_id: "call_c", name: "read" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_001", delta: '{"path":"/a' },
      { type: "response.function_call_arguments.delta", item_id: "fc_002", delta: '{"path":"/b' },
      { type: "response.function_call_arguments.delta", item_id: "fc_003", delta: '{"path":"/c' },
      { type: "response.function_call_arguments.delta", item_id: "fc_002", delta: '"}' },
      { type: "response.function_call_arguments.delta", item_id: "fc_001", delta: '"}' },
      { type: "response.function_call_arguments.delta", item_id: "fc_003", delta: '"}' },
      { type: "response.output_item.done", item: { type: "function_call", id: "fc_001", call_id: "call_a", name: "read" } },
      { type: "response.output_item.done", item: { type: "function_call", id: "fc_002", call_id: "call_b", name: "read" } },
      { type: "response.output_item.done", item: { type: "function_call", id: "fc_003", call_id: "call_c", name: "read" } },
      { type: "response.output_item.added", item: { type: "function_call", id: "fc_004", call_id: "call_d", name: "read" } },
    ];

    for (const event of events) {
      for (const call of toolCalls(event, state)) {
        if (call.id) indices.set(call.id, call.index);
        if (call.function.arguments) {
          argumentsByIndex.set(call.index, (argumentsByIndex.get(call.index) ?? "") + call.function.arguments);
        }
      }
    }

    expect(new Set(indices.values())).toEqual(new Set([0, 1, 2, 3]));
    expect(indices.get("call_d")).toBe(3);
    expect(JSON.parse(argumentsByIndex.get(indices.get("call_a")))).toEqual({ path: "/a" });
    expect(JSON.parse(argumentsByIndex.get(indices.get("call_b")))).toEqual({ path: "/b" });
    expect(JSON.parse(argumentsByIndex.get(indices.get("call_c")))).toEqual({ path: "/c" });
  });

  it("uses the current call index when a delta item id is unrecognizable", () => {
    const state = {};

    const [added] = toolCalls(
      { type: "response.output_item.added", item: { type: "function_call", call_id: "call_fallback", name: "read" } },
      state
    );
    const [delta] = toolCalls(
      { type: "response.function_call_arguments.delta", item_id: "unrecognized_item", delta: "{}" },
      state
    );

    expect(delta.index).toBe(added.index);
    expect(delta.function.arguments).toBe("{}");
  });
});
