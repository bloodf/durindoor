import { describe, it, expect } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

const chunk = (delta, finish = null) => ({ id: "c1", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
const call = (id, name, args) => chunk({ tool_calls: [{ index: 0, ...(id ? { id } : null), function: { ...(name ? { name } : null), arguments: args } }] });

describe("OmniRoute #20232: an upstream that reuses a tool-call index", () => {
  it("keeps every call with its own name, arguments and output index", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [call("a", "first", "{\"x\":"), call(null, null, "1}"), call("b", "second", "{\"y\":"), call(null, null, "2}"), chunk({}, "tool_calls")]
      .flatMap((value) => openaiToOpenAIResponsesResponse(value, state) || []);
    const done = events.filter((event) => event.event === "response.output_item.done").map((event) => event.data);
    expect(done.map(({ item }) => [item.call_id, item.name, item.arguments])).toEqual([["a", "first", "{\"x\":1}"], ["b", "second", "{\"y\":2}"]]);
    expect(new Set(done.map((data) => data.output_index)).size).toBe(2);
  });
});
