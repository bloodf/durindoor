import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";

const send = (state, tool_calls) => openaiToAntigravityResponse({ choices: [{ delta: { tool_calls } }] }, state);
const finish = (state) => openaiToAntigravityResponse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }, state)
  .response.candidates[0].content.parts.map((part) => part.functionCall);

describe("Antigravity indexless explicit tool IDs", () => {
  it("opens a new call instead of replacing the active identified call", () => {
    const state = {};
    send(state, [{ index: 0, id: "one", function: { name: "first", arguments: '{"a":' } }]);
    send(state, [{ index: 1, function: { name: "second", arguments: '{"b":2}' } }]);
    send(state, [{ index: 0, function: { arguments: "1}" } }]);
    send(state, [{ id: "three", function: { arguments: "" } }]);
    send(state, [{ id: "one", function: { arguments: "" } }]);
    expect(finish(state)).toEqual([
      { id: "one", name: "first", args: { a: 1 } },
      { id: "three", name: "second", args: { b: 2 } },
    ]);
  });

  it("creates a distinct call when no slot is unbound", () => {
    const state = {};
    send(state, [{ index: 0, id: "one", function: { name: "first", arguments: '{"a":1}' } }]);
    send(state, [{ id: "two", function: { name: "second", arguments: '{"b":' } }]);
    send(state, [{ function: { arguments: "2}" } }]);
    expect(finish(state)).toEqual([
      { id: "one", name: "first", args: { a: 1 } },
      { id: "two", name: "second", args: { b: 2 } },
    ]);
  });

  it("opens a new call when the unbound slot has a different name", () => {
    const state = {};
    send(state, [{ index: 0, function: { name: "first", arguments: '{"a":1}' } }]);
    send(state, [{ id: "two", function: { name: "second", arguments: '{"b":2}' } }]);
    expect(finish(state)).toEqual([
      { name: "first", args: { a: 1 } },
      { id: "two", name: "second", args: { b: 2 } },
    ]);
  });

  it("does not guess between multiple unbound slots", () => {
    const state = {};
    send(state, [{ index: 0, function: { name: "first", arguments: '{"a":1}' } }]);
    send(state, [{ index: 1, function: { name: "second", arguments: '{"b":2}' } }]);
    send(state, [{ id: "three", function: { name: "third", arguments: '{"c":3}' } }]);
    expect(finish(state)).toEqual([
      { name: "first", args: { a: 1 } },
      { name: "second", args: { b: 2 } },
      { id: "three", name: "third", args: { c: 3 } },
    ]);
  });
});
