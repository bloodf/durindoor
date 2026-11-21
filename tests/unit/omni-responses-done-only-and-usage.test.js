import { describe, it, expect } from "vitest";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesResponse as toResponses, openaiResponsesToOpenAIResponse as toChat } from "../../open-sse/translator/response/openai-responses.js";

const chat = (delta, finish_reason = null, usage) => ({ id: "c", model: "gpt-5.6-luna", choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) });
const flatten = (result) => result ? (Array.isArray(result) ? result : [result]) : [];

describe("Responses stream parity", () => {
  it("preserves function argument bytes at every split in both directions", () => {
    const raw = JSON.stringify({ path: "C:\\temp", text: "\\theta" });
    for (let split = 0; split <= raw.length; split++) {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      const events = [];
      for (const [i, args] of [raw.slice(0, split), raw.slice(split)].entries()) {
        events.push(...toResponses(chat({ tool_calls: [{ index: 0, ...(i === 0 ? { id: "call_a" } : {}), function: { ...(i === 0 ? { name: "lookup" } : {}), arguments: args } }] }), state));
      }
      events.push(...toResponses(chat({}, "tool_calls", { prompt_tokens: 2, completion_tokens: 1 }), state));
      expect(events.find((e) => e.event === "response.function_call_arguments.done").data.arguments).toBe(raw);
      const reverse = initState(FORMATS.OPENAI);
      const chunks = events.flatMap((e) => flatten(toChat(e, reverse)));
      expect(chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []).map((c) => c.function?.arguments || "").join("")).toBe(raw);
    }
  });

  it("projects accumulated usage while keeping shared cost and cache fields", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.usage = { cost_usd: 0.25, provider_credits: 3 };
    toResponses(chat({ content: "hi" }, null, { prompt_tokens: 100, cached_tokens: 40 }), state);
    const events = toResponses(chat({}, "stop", { completion_tokens: 7, reasoning_tokens: 2 }), state);
    const usage = events.find((e) => e.event === "response.completed").data.response.usage;
    expect(usage).toMatchObject({ input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 2 } });
    expect(state.usage).toMatchObject({ cost_usd: 0.25, provider_credits: 3, prompt_tokens: 100, completion_tokens: 7 });
  });

  it("emits a header and exact arguments for done-only parallel calls and finishes once", () => {
    const state = initState(FORMATS.OPENAI);
    const items = ["a", "b"].map((id) => ({ type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name: `tool_${id}`, arguments: JSON.stringify({ path: `C:\\temp\\${id}` }) }));
    const events = items.map((item, output_index) => ({ type: "response.output_item.done", output_index, item }));
    events.push({ type: "response.completed", response: { status: "completed", output: items, usage: { input_tokens: 3, output_tokens: 2 } } });
    const chunks = events.flatMap((e) => flatten(toChat(e, state)));
    const calls = chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || []);
    for (const [index, item] of items.entries()) {
      const parts = calls.filter((call) => call.index === index);
      expect(parts.filter((call) => call.id)).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: item.call_id, type: "function", function: { name: item.name } });
      expect(parts.map((call) => call.function?.arguments || "").join("")).toBe(item.arguments);
    }
    expect(chunks.filter((c) => c.choices?.[0]?.finish_reason)).toHaveLength(1);
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("does not invent another call for an anonymous done after added and delta", () => {
    const state = initState(FORMATS.OPENAI);
    const events = [
      { type: "response.output_item.added", item: { type: "function_call", call_id: "call_a", name: "lookup" } },
      { type: "response.function_call_arguments.delta", delta: '{"x":1}' },
      { type: "response.output_item.done", item: { type: "function_call" } },
      { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } }
    ];
    const chunks = events.flatMap((event) => flatten(toChat(event, state)));
    const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    expect(calls.filter((call) => call.id)).toHaveLength(1);
    expect(calls.every((call) => call.index === 0)).toBe(true);
    expect(calls.map((call) => call.function?.arguments || "").join("")).toBe('{"x":1}');
  });
});
