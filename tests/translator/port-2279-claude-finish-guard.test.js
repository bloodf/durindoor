// Regression for upstream decolua/9router#2279 — doubled tool args openai→claude.
// Some OpenAI-compatible models emit a tool_call's arguments as the same JSON
// object twice ({"q":"x"}{"q":"x"}). The Claude response translator must
// collapse that to a single valid JSON object in the input_json_delta it emits
// at finish; otherwise the Claude consumer receives malformed tool input.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

const chunk = (delta, extra = {}) => ({
  id: "chatcmpl-x",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: extra.finish_reason ?? null }],
  ...extra,
});

const freshState = () => ({
  toolCalls: new Map(),
  textBlockStarted: false,
  thinkingBlockStarted: false,
});

function drive(argsChunk) {
  const state = freshState();
  const out = [];
  out.push(...(openaiToClaudeResponse(chunk({ content: null }), state) || [])); // message_start
  out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Read" } }] }), state) || []));
  out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: argsChunk } }] }), state) || []));
  out.push(...(openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state) || []));
  return { state, out };
}

describe("port #2279: doubled tool args openai→claude collapse to one object", () => {
  it("deduplicates doubled JSON arguments into a single parseable object", () => {
    const original = { file_path: "/tmp/a.ts", limit: 10 };
    const doubled = JSON.stringify(original) + JSON.stringify(original);
    const { out } = drive(doubled);
    const deltas = out.filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(deltas.length, "no input_json_delta emitted").toBeGreaterThan(0);
    const partial = deltas[deltas.length - 1].delta.partial_json;
    // Must parse exactly once — not doubled, not the raw concatenation.
    const parsed = JSON.parse(partial);
    expect(parsed).toEqual(original);
    expect(partial, "doubled JSON not collapsed").not.toBe(doubled);
  });

  it("passes already-single JSON arguments through unchanged", () => {
    const original = { query: "hello", n: 3 };
    const { out } = drive(JSON.stringify(original));
    const deltas = out.filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(JSON.parse(deltas[deltas.length - 1].delta.partial_json)).toEqual(original);
  });

  it("emits message_stop exactly once on finish (finish guard side-effect)", () => {
    const { out, state } = drive(JSON.stringify({ q: 1 }));
    const stops = out.filter((e) => e?.type === "message_stop");
    expect(stops, "expected exactly one message_stop").toHaveLength(1);
    expect(state.claudeFinishHandled).toBe(true);
  });
});
