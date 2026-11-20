import "../translator/registerAll.js";
import { describe, it, expect } from "vitest";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";

// Streamed tool-call fragments must stay with the call that owns them: an
// indexless continuation belongs to the most recently active call, not to the
// call with the highest index.
const send = (state, delta) => openaiToAntigravityResponse({ choices: [{ delta }] }, state);
const finish = (state) =>
  openaiToAntigravityResponse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }, state);
const callsOf = (result) => result.response.candidates[0].content.parts.map(part => part.functionCall);
const argsOf = (result) => callsOf(result).map(call => call.args);

describe("Antigravity streamed tool-call fragment ownership", () => {
  it("keeps an indexless fragment with the call that was most recently active", () => {
    const state = {};
    send(state, { tool_calls: [{ index: 0, id: "one", function: { name: "first", arguments: '{"a":' } }] });
    send(state, { tool_calls: [{ index: 1, id: "two", function: { name: "second", arguments: '{"b":2}' } }] });
    // The provider resumes the earlier call, so the next indexless fragment
    // belongs to index 0 even though index 1 is the highest one.
    send(state, { tool_calls: [{ index: 0, function: { arguments: "1" } }] });
    send(state, { tool_calls: [{ function: { arguments: "}" } }] });

    const result = finish(state);
    expect(argsOf(result)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(callsOf(result)).toEqual([
      { id: "one", name: "first", args: { a: 1 } },
      { id: "two", name: "second", args: { b: 2 } },
    ]);
  });

  it("routes an indexless fragment to the call named by its id", () => {
    const state = {};
    send(state, { tool_calls: [{ index: 0, id: "one", function: { name: "first", arguments: '{"a":' } }] });
    send(state, { tool_calls: [{ index: 1, id: "two", function: { name: "second", arguments: '{"b":2}' } }] });
    send(state, { tool_calls: [{ id: "one", function: { arguments: "1}" } }] });

    const result = finish(state);
    expect(argsOf(result)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("keeps a single unnamed call intact across indexless fragments", () => {
    const state = {};
    send(state, { tool_calls: [{ index: 0, function: { name: "solo", arguments: '{"a":' } }] });
    send(state, { tool_calls: [{ function: { arguments: "1" } }] });
    send(state, { tool_calls: [{ function: { arguments: "}" } }] });

    const result = finish(state);
    expect(callsOf(result)).toEqual([{ name: "solo", args: { a: 1 } }]);
  });

  it("keeps consecutive indexless calls with different ids distinct", () => {
    const state = {};
    send(state, { tool_calls: [{ id: "one", function: { name: "first", arguments: '{"a":' } }] });
    send(state, { tool_calls: [{ function: { arguments: "1}" } }] });
    send(state, { tool_calls: [{ id: "two", function: { name: "second", arguments: '{"b":2}' } }] });

    const result = finish(state);
    expect(callsOf(result)).toEqual([
      { id: "one", name: "first", args: { a: 1 } },
      { id: "two", name: "second", args: { b: 2 } },
    ]);
  });

  it("does not guess an owner when several calls are open and none is active", () => {
    const state = {
      _toolCallAccum: {
        0: { id: "one", name: "first", arguments: '{"a":1}' },
        1: { id: "two", name: "second", arguments: '{"b":2}' },
      },
    };
    send(state, { tool_calls: [{ function: { arguments: "}" } }] });

    const result = finish(state);
    expect(argsOf(result)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
