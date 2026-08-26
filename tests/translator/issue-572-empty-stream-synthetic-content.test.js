// Regression for #572 — emit synthetic content delta for empty/thinking-only
// Claude→OpenAI streams. AI SDK / Kilo (and similar OpenAI-compat clients)
// throw APIEmptyResponseError when a stream reaches finish_reason without any
// prior delta.content or tool_calls, even though the upstream stream
// succeeded. Before the terminal chunk, if neither text nor tool calls were
// emitted, the translator must push a single whitespace content delta.
// Independent re-implementation of the VansRouter 5cc11b8 intent.
import { describe, it, expect } from "vitest";
import { isString } from "../../src/shared/utils/typeChecks.js";
import "./registerAll.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

// Mirrors the state shape produced by open-sse/translator/index.js — the real
// pipeline always initializes toolCalls as a Map before streaming begins.
const freshState = () => ({ messageId: "m1", model: "m", toolCallIndex: 0, toolCalls: new Map() });

function collect(events) {
  const state = freshState();
  const out = [];
  for (const ev of events) out.push(...(claudeToOpenAIResponse(ev, state) || []));
  return out;
}

const contentDeltas = (out) =>
  out.map((e) => e?.choices?.[0]?.delta?.content).filter((s) => isString(s));

const finishChunks = (out) =>
  out.filter((e) => e?.choices?.[0]?.finish_reason);

describe("issue #572: synthetic content delta for empty/thinking-only streams", () => {
  it("empty stream (no content blocks) emits a whitespace content delta before finish", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
    ]);
    const contents = contentDeltas(out);
    expect(contents, "no synthetic content emitted for empty stream").toHaveLength(1);
    expect(contents[0], "synthetic delta must be whitespace").toBe(" ");
    const finishes = finishChunks(out);
    expect(finishes, "exactly one finish chunk expected").toHaveLength(1);
    // Synthetic delta must precede the finish chunk
    const contentIdx = out.findIndex((e) => e?.choices?.[0]?.delta?.content === " ");
    const finishIdx = out.indexOf(finishes[0]);
    expect(contentIdx, "synthetic delta must precede finish_reason").toBeLessThan(finishIdx);
  });

  it("thinking-only stream emits a whitespace content delta before finish", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]);
    const contents = contentDeltas(out);
    expect(contents, "no synthetic content emitted for thinking-only stream").toHaveLength(1);
    expect(contents[0]).toBe(" ");
    // Reasoning must still flow through the reasoning channel untouched
    expect(JSON.stringify(out), "reasoning content dropped").toContain("pondering");
    expect(finishChunks(out), "exactly one finish chunk expected").toHaveLength(1);
  });

  it("finish via message_stop only (no message_delta) still gets the synthetic delta", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "message_stop" },
    ]);
    const contents = contentDeltas(out);
    expect(contents, "message_stop path missed the synthetic delta").toHaveLength(1);
    expect(contents[0]).toBe(" ");
  });

  it("normal content stream is unchanged (no synthetic delta injected)", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answer" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]);
    const contents = contentDeltas(out);
    expect(contents.join(""), "content altered").toBe("answer");
    expect(contents, "extra synthetic delta injected into normal stream").toHaveLength(1);
    expect(finishChunks(out)).toHaveLength(1);
  });

  it("tool-call-only stream is unchanged (tool_calls count as content)", () => {
    const out = collect([
      { type: "message_start", message: { id: "m1", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "lookup" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":1}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ]);
    expect(contentDeltas(out), "synthetic delta injected into tool-call stream").toHaveLength(0);
    const finishes = finishChunks(out);
    expect(finishes).toHaveLength(1);
    expect(finishes[0].choices[0].finish_reason).toBe("tool_calls");
  });
});
