import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  CLAUDE_STOP,
  GEMINI_FINISH,
  GEMINI_ROLE,
  OPENAI_FINISH,
  ROLE,
} from "../../open-sse/translator/schema/index.js";

/**
 * #1330 / #1089: Chat JSON `finish_reason: "error"` must become a Claude error
 * terminal and a Gemini abort finishReason (OTHER), not end_turn / STOP.
 *
 * Assertions match the two skipped cases in PR #1322
 * (`v5-conformance-matrix-chat.test.js` at 34e90258). That matrix file is not
 * edited here; flip those skips once #1322 merges.
 */

const CHAT = FORMATS.OPENAI;
const CLAUDE = FORMATS.CLAUDE;
const GEMINI = FORMATS.GEMINI;

const completion = (finish_reason, message) => ({
  id: "chat-1330",
  model: "m",
  object: "chat.completion",
  choices: [{ index: 0, message, finish_reason }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const textMessage = (content = "partial") => ({ role: ROLE.ASSISTANT, content });

const nonstream = (target, finish, message = textMessage()) =>
  translateNonStreamingResponse(completion(finish, message), CHAT, target);

describe("#1330 Chat JSON error finish → Claude/Gemini terminals", () => {
  it("maps non-stream error finish to a Claude error terminal", () => {
    const out = nonstream(CLAUDE, OPENAI_FINISH.ERROR);
    expect(out.stop_reason).not.toBe(CLAUDE_STOP.END_TURN);
    expect(out).toMatchObject({ type: "error" });
  });

  it("maps non-stream error finish to a Gemini abort finishReason", () => {
    const out = nonstream(GEMINI, OPENAI_FINISH.ERROR);
    expect(out.candidates[0].finishReason).not.toBe(GEMINI_FINISH.STOP);
    expect(out.candidates[0].finishReason).toBe(GEMINI_FINISH.OTHER);
  });

  it("keeps non-stream stop and length mappings for Claude and Gemini", () => {
    const claudeStop = nonstream(CLAUDE, OPENAI_FINISH.STOP);
    expect(claudeStop).toMatchObject({
      type: "message",
      stop_reason: CLAUDE_STOP.END_TURN,
      content: [{ type: "text", text: "partial" }],
    });

    const claudeLength = nonstream(CLAUDE, OPENAI_FINISH.LENGTH);
    expect(claudeLength.stop_reason).toBe(CLAUDE_STOP.MAX_TOKENS);
    expect(claudeLength.content[0]).toEqual({ type: "text", text: "partial" });

    const geminiStop = nonstream(GEMINI, OPENAI_FINISH.STOP);
    expect(geminiStop.candidates[0]).toMatchObject({
      finishReason: GEMINI_FINISH.STOP,
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "partial" }] },
    });

    const geminiLength = nonstream(GEMINI, OPENAI_FINISH.LENGTH);
    expect(geminiLength.candidates[0]).toMatchObject({
      finishReason: GEMINI_FINISH.MAX_TOKENS,
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text: "partial" }] },
    });
  });
});
