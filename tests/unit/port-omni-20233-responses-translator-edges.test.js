import { describe, it, expect } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

const chunk = (delta, finish = null) => ({ id: "c1", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
const usage = { id: "c1", choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
const translate = (state, value) => openaiToOpenAIResponsesResponse(value, state) || [];

describe("OmniRoute #20233: Chat to Responses stream edges", () => {
  it("drops content and tool chunks that arrive after response.completed", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [chunk({ content: "hi" }), chunk({}, "stop"), usage].flatMap((value) => translate(state, value));
    expect(events.at(-1).event).toBe("response.completed");
    expect(translate(state, chunk({ content: "late" }))).toEqual([]);
    expect(translate(state, chunk({ tool_calls: [{ index: 0, id: "call_late", function: { name: "run", arguments: "{}" } }] }))).toEqual([]);
  });

  it("keeps object-valued tool arguments as JSON text", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "run", arguments: { path: "a.txt" } } }] }),
      chunk({}, "tool_calls"), usage
    ].flatMap((value) => translate(state, value));
    const done = events.find((event) => event.event === "response.output_item.done" && event.data.item.type === "function_call");
    expect(done.data.item.arguments).toBe('{"path":"a.txt"}');
    expect(events.find((event) => event.event === "response.function_call_arguments.delta").data.delta).toBe('{"path":"a.txt"}');
  });
});
