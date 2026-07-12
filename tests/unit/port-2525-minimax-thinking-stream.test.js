// Regression tests for upstream decolua/9router PR #2525
// (head 72385571c6): MiniMax OpenAI transport passthrough —
// reasoning_split requestDefaults, omitStreamReasoning, and streamed
// thinking-marker peeling (minimaxThinkingStream.js).

import { describe, it, expect } from "vitest";
import {
  createMinimaxThinkingStreamState,
  processMinimaxThinkingText,
  sanitizeMinimaxDelta,
  flushMinimaxThinkingStreamState,
  isMinimaxThinkingProvider,
  shouldOmitStreamReasoning,
  stripClientReasoningDelta,
} from "../../open-sse/utils/minimaxThinkingStream.js";

describe("port-2525 minimaxThinkingStream", () => {
  it("detects minimax providers only", () => {
    expect(isMinimaxThinkingProvider("minimax")).toBe(true);
    expect(isMinimaxThinkingProvider("minimax-cn")).toBe(true);
    expect(isMinimaxThinkingProvider("openai")).toBe(false);
    expect(isMinimaxThinkingProvider(undefined)).toBe(false);
  });

  it("splits think markers in a single chunk into content + reasoning", () => {
    const out = processMinimaxThinkingText("<think>\nplan\n</think>\nHi", false);
    expect(out).toEqual({
      content: "\nHi",
      reasoning: "\nplan\n",
      carry: "",
      inThinking: false,
    });
  });

  it("splits mm:think markers", () => {
    const out = processMinimaxThinkingText("<mm:think>why</mm:think>ok", false);
    expect(out.content).toBe("ok");
    expect(out.reasoning).toBe("why");
    expect(out.inThinking).toBe(false);
  });

  it("strips orphaned closing mm:think tag", () => {
    const out = processMinimaxThinkingText("</mm:think>answer", false);
    expect(out.content).toBe("answer");
    expect(out.reasoning).toBe("");
  });

  it("holds a partial end marker across chunk boundaries", () => {
    const state = createMinimaxThinkingStreamState();
    const d1 = { content: "<mm:think>why</mm:thi" };
    sanitizeMinimaxDelta(d1, state);
    expect(d1.content).toBeUndefined();
    expect(d1.reasoning_content).toBe("why");

    const d2 = { content: "nk>ok" };
    sanitizeMinimaxDelta(d2, state);
    expect(d2.content).toBe("ok");
    expect(state.inThinking).toBe(false);
  });

  it("maps delta.reasoning to reasoning_content and removes the alias", () => {
    const state = createMinimaxThinkingStreamState();
    const delta = { content: "</mm:think>answer", reasoning: "trail" };
    expect(sanitizeMinimaxDelta(delta, state)).toBe(true);
    expect(delta.content).toBe("answer");
    expect(delta.reasoning_content).toBe("trail");
    expect(delta.reasoning).toBeUndefined();
  });

  it("merges reasoning_details text into reasoning_content without duplicates", () => {
    const state = createMinimaxThinkingStreamState();
    const delta = {
      content: "hi",
      reasoning_details: [{ text: "step1" }, "step2"],
    };
    expect(sanitizeMinimaxDelta(delta, state)).toBe(true);
    expect(delta.reasoning_content).toBe("step1step2");
  });

  it("flushes trailing carry as reasoning when stream ends mid-thinking", () => {
    const state = createMinimaxThinkingStreamState();
    state.carry = "tail";
    state.inThinking = true;
    const flushed = flushMinimaxThinkingStreamState(state);
    expect(flushed).toEqual({ content: "", reasoning: "tail" });
    expect(state.carry).toBe("");
  });

  it("flushes trailing carry as content when not in thinking", () => {
    const state = createMinimaxThinkingStreamState();
    state.carry = "hel";
    state.inThinking = false;
    expect(flushMinimaxThinkingStreamState(state)).toEqual({ content: "hel", reasoning: "" });
  });

  it("honors omitStreamReasoning from the openai transport registry entry", () => {
    expect(shouldOmitStreamReasoning("minimax")).toBe(true);
    expect(shouldOmitStreamReasoning("minimax-cn")).toBe(true);
    expect(shouldOmitStreamReasoning("openai")).toBe(false);
  });

  it("strips reasoning fields from client deltas when requested", () => {
    const delta = { content: "hi", reasoning_content: "secret", reasoning_details: [{ text: "x" }] };
    expect(stripClientReasoningDelta(delta)).toBe(true);
    expect(delta).toEqual({ content: "hi" });
  });

  it("no-ops on deltas without reasoning fields", () => {
    const delta = { content: "hi" };
    expect(stripClientReasoningDelta(delta)).toBe(false);
    expect(delta).toEqual({ content: "hi" });
  });
});
