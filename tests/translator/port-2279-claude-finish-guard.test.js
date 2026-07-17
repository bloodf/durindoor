// Regression for upstream decolua/9router#2279 — doubled tool args openai→claude.
// Some OpenAI-compatible models emit a tool_call's arguments as the same JSON
// object twice ({"q":"x"}{"q":"x"}). The Claude response translator must
// collapse that to a single valid JSON object in the input_json_delta it emits
// at finish; otherwise the Claude consumer receives malformed tool input.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

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

  // Pivot-path regression — the maintainer's primary concern on #2279.
  // In a pivot like Antigravity/Gemini → OpenAI → Claude, an upstream stage has
  // already set state.finishReason before openai-to-claude runs (stream.js reads
  // it for usage injection). The finish flush must key on the Claude-specific
  // state.claudeFinishHandled flag, NOT on the shared state.finishReason: keying
  // on the latter would skip the flush entirely and drop the buffered tool-call
  // input_json_delta. The first finish chunk must still emit message_delta
  // (exactly once, even across repeated finish chunks).
  it("pivot path: state.finishReason already truthy at handler entry still emits message_delta exactly once", () => {
    const state = freshState();
    const out = [];
    out.push(...(openaiToClaudeResponse(chunk({ content: null }), state) || [])); // message_start
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Read" } }] }), state) || []));
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/tmp/a.ts" }) } }] }), state) || []));

    // Pivot simulation: upstream stage already recorded the finish reason before
    // the first finish chunk reaches openai-to-claude.
    state.finishReason = "tool_calls";

    out.push(...(openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state) || []));
    out.push(...(openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state) || [])); // duplicate finish chunk

    const deltas = out.filter((e) => e?.type === "message_delta");
    expect(deltas, "message_delta must still be emitted when state.finishReason was already set").toHaveLength(1);
    expect(deltas[0].delta.stop_reason).toBe("tool_use");
    expect(out.filter((e) => e?.type === "message_stop")).toHaveLength(1);

    // The buffered tool args must not be dropped by the finish guard.
    const inputDeltas = out.filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(inputDeltas).toHaveLength(1);
    expect(JSON.parse(inputDeltas[0].delta.partial_json)).toEqual({ file_path: "/tmp/a.ts" });
  });
});

describe("port #2279: claude→openai request bridge keeps string tool input verbatim", () => {
  // Request half of #2279: a tool_use block whose `input` is already a serialized
  // JSON string (produced by a prior bridge pass) must pass through untouched.
  // JSON.stringify-ing it again would double-encode the arguments into a quoted
  // blob, which is exactly how doubled tool args enter the OpenAI leg upstream.
  it("passes an already-string tool_use input through without re-serializing", () => {
    const inputString = JSON.stringify({ file_path: "/tmp/a.ts", limit: 10 });
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", {
      messages: [{ role: "assistant", content: [
        { type: "tool_use", id: "toolu_1", name: "Read", input: inputString },
      ] }],
    }, true, null, null);
    const toolCalls = out.messages[0].tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.arguments, "string input was re-serialized / double-encoded").toBe(inputString);
  });

  it("still serializes object tool_use input exactly once", () => {
    const input = { file_path: "/tmp/a.ts" };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", {
      messages: [{ role: "assistant", content: [
        { type: "tool_use", id: "toolu_2", name: "Read", input },
      ] }],
    }, true, null, null);
    expect(out.messages[0].tool_calls[0].function.arguments).toBe(JSON.stringify(input));
  });
});

describe("port #2279: adversarial finish-guard boundaries (QA)", () => {
  // Boundary: an empty-string finishReason is falsy but explicitly set. The guard
  // must treat it as not-yet-handled — same as null/undefined — and still run the
  // finish block on the first real finish chunk.
  it("empty-string state.finishReason at handler entry still runs the finish block", () => {
    const state = freshState();
    const out = [];
    out.push(...(openaiToClaudeResponse(chunk({ content: null }), state) || [])); // message_start
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Read" } }] }), state) || []));
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/tmp/a.ts" }) } }] }), state) || []));

    // Falsy-but-set: must not suppress the finish block.
    state.finishReason = "";

    out.push(...(openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state) || []));

    expect(state.claudeFinishHandled, "finish block never ran for '' finishReason").toBe(true);
    expect(state.finishReason, "empty finishReason not overwritten by real reason").toBe("tool_calls");
    const deltas = out.filter((e) => e?.type === "message_delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta.stop_reason).toBe("tool_use");
    expect(out.filter((e) => e?.type === "message_stop")).toHaveLength(1);
    const inputDeltas = out.filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(inputDeltas).toHaveLength(1);
    expect(JSON.parse(inputDeltas[0].delta.partial_json)).toEqual({ file_path: "/tmp/a.ts" });
  });

  // Boundary: the Claude-specific single-finish flag already set at handler entry
  // (a prior finish chunk, or finalizeOnFlush on a truncated stream) must skip the
  // finish block entirely — no second message_delta/message_stop, buffered tool
  // args not flushed again, and state.finishReason left untouched.
  it("state.claudeFinishHandled = true at handler entry skips the finish block entirely", () => {
    const state = freshState();
    const out = [];
    out.push(...(openaiToClaudeResponse(chunk({ content: null }), state) || [])); // message_start
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Read" } }] }), state) || []));
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ q: 1 }) } }] }), state) || []));

    // Simulate a prior handler pass already owning the finish; distinct reason so
    // any stray finish-block run would visibly overwrite it.
    state.claudeFinishHandled = true;
    state.finishReason = "stop";

    out.push(...(openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state) || []));

    expect(out.filter((e) => e?.type === "message_delta"), "finish block ran despite claudeFinishHandled").toHaveLength(0);
    expect(out.filter((e) => e?.type === "message_stop")).toHaveLength(0);
    expect(out.filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta"), "buffered tool args flushed a second time").toHaveLength(0);
    expect(state.finishReason, "finishReason overwritten on suppressed finish").toBe("stop");
    expect(state.claudeFinishHandled).toBe(true);
  });

  // Stress: some OpenAI-compatible models repeat the finish chunk. Three consecutive
  // finish chunks must collapse to exactly one finish emission set — the flag latches
  // on chunk one and suppresses chunks two and three.
  it("three consecutive finish chunks emit message_delta/message_stop/input_json_delta exactly once", () => {
    const state = freshState();
    const out = [];
    out.push(...(openaiToClaudeResponse(chunk({ content: null }), state) || [])); // message_start
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Read" } }] }), state) || []));
    out.push(...(openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/tmp/a.ts" }) } }] }), state) || []));

    for (let i = 0; i < 3; i++) {
      out.push(...(openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state) || []));
    }

    const deltas = out.filter((e) => e?.type === "message_delta");
    expect(deltas, "finish guard failed to latch across repeated finish chunks").toHaveLength(1);
    expect(deltas[0].delta.stop_reason).toBe("tool_use");
    expect(out.filter((e) => e?.type === "message_stop")).toHaveLength(1);
    const inputDeltas = out.filter((e) => e?.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(inputDeltas, "buffered tool args flushed more than once").toHaveLength(1);
    expect(JSON.parse(inputDeltas[0].delta.partial_json)).toEqual({ file_path: "/tmp/a.ts" });
    expect(state.claudeFinishHandled).toBe(true);
    expect(state.finishReason).toBe("tool_calls");
  });
});
