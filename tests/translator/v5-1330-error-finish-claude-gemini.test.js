import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { translateOpenAIToClaudeIfNeeded } from "../../open-sse/translator/response/openai-to-claude-json.js";
import { projectCompletionToClientFormat } from "../../open-sse/translator/response/completionProjector.js";
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
 * (`v5-conformance-matrix-chat.test.js` at e193f0cf). That matrix file is not
 * edited here; flip those skips once #1322 merges.
 *
 * Robustness (sibling #1336 review): inputs where main produced no throw / no
 * new terminal must still do so — only the known string `"error"` finish drives
 * the new Claude/Gemini terminals.
 *
 * Exact-value policy (#1323 CTO review): assert mapped stop/finish reasons,
 * error type + message text, and which content/candidate slot holds each block.
 * No existence-only checks (`toBeTruthy`, `toMatchObject` partials, `expect.any`
 * for mapped fields).
 */

const CHAT = FORMATS.OPENAI;
const CLAUDE = FORMATS.CLAUDE;
const GEMINI = FORMATS.GEMINI;

/** Must match DEFAULT_UPSTREAM_ABORT_MESSAGE in openai-to-claude-json.js. */
const DEFAULT_CLAUDE_ABORT_MESSAGE =
  "Upstream aborted the response (malformed function call or empty candidate)";

const COMPLETION_ID = "chat-1330";
const COMPLETION_MODEL = "m";

const completion = (finish_reason, message, extra = {}) => ({
  id: COMPLETION_ID,
  model: COMPLETION_MODEL,
  object: "chat.completion",
  choices: [{ index: 0, message, finish_reason }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  ...extra,
});

const textMessage = (content = "partial") => ({ role: ROLE.ASSISTANT, content });

const nonstream = (target, finish, message = textMessage(), extra = {}) =>
  translateNonStreamingResponse(completion(finish, message, extra), CHAT, target);

const claudeDirect = (body) => translateOpenAIToClaudeIfNeeded(body, CLAUDE);
const geminiDirect = (body) => projectCompletionToClientFormat(body, GEMINI);

const expectClaudeMessage = (out, { stop_reason, text }) => {
  expect(out).toEqual({
    id: `msg_${COMPLETION_ID}`,
    type: "message",
    role: ROLE.ASSISTANT,
    content: [{ type: "text", text }],
    model: COMPLETION_MODEL,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  // Slot: the sole content block is the text at index 0.
  expect(out.content).toHaveLength(1);
  expect(out.content[0]).toEqual({ type: "text", text });
  expect(out.stop_reason).toBe(stop_reason);
};

const expectGeminiResponse = (wrappedOrBare, { finishReason, text }) => {
  const response = wrappedOrBare.response ?? wrappedOrBare;
  expect(response).toEqual({
    candidates: [{
      content: { role: GEMINI_ROLE.MODEL, parts: [{ text }] },
      finishReason,
      index: 0,
    }],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2,
    },
    modelVersion: COMPLETION_MODEL,
    responseId: COMPLETION_ID,
  });
  // Slot: the sole candidate at index 0 holds the finish reason and text part.
  expect(response.candidates).toHaveLength(1);
  expect(response.candidates[0].index).toBe(0);
  expect(response.candidates[0].finishReason).toBe(finishReason);
  expect(response.candidates[0].content.parts).toEqual([{ text }]);
};

const expectClaudeErrorTerminal = (out, message) => {
  expect(out).toEqual({
    type: "error",
    error: { type: "api_error", message },
  });
  expect(Object.keys(out).sort()).toEqual(["error", "type"]);
  expect(out.error.type).toBe("api_error");
  expect(out.error.message).toBe(message);
  expect(out.stop_reason).toBeUndefined();
  expect(out.content).toBeUndefined();
};

describe("#1330 Chat JSON error finish → Claude/Gemini terminals", () => {
  it("maps non-stream error finish to a Claude error terminal", () => {
    const out = nonstream(CLAUDE, OPENAI_FINISH.ERROR);
    // #1322 matrix: not end_turn + type error — asserted exactly below.
    expectClaudeErrorTerminal(out, DEFAULT_CLAUDE_ABORT_MESSAGE);
    expect(out.stop_reason).not.toBe(CLAUDE_STOP.END_TURN);
  });

  it("maps non-stream error finish to a Gemini abort finishReason", () => {
    const out = nonstream(GEMINI, OPENAI_FINISH.ERROR);
    // #1322 matrix: not STOP + OTHER — asserted exactly via helper.
    expectGeminiResponse(out, { finishReason: GEMINI_FINISH.OTHER, text: "partial" });
    expect(out.candidates[0].finishReason).not.toBe(GEMINI_FINISH.STOP);
  });

  it("keeps non-stream stop and length mappings for Claude and Gemini", () => {
    expectClaudeMessage(nonstream(CLAUDE, OPENAI_FINISH.STOP), {
      stop_reason: CLAUDE_STOP.END_TURN,
      text: "partial",
    });
    expectClaudeMessage(nonstream(CLAUDE, OPENAI_FINISH.LENGTH), {
      stop_reason: CLAUDE_STOP.MAX_TOKENS,
      text: "partial",
    });
    expectGeminiResponse(nonstream(GEMINI, OPENAI_FINISH.STOP), {
      finishReason: GEMINI_FINISH.STOP,
      text: "partial",
    });
    expectGeminiResponse(nonstream(GEMINI, OPENAI_FINISH.LENGTH), {
      finishReason: GEMINI_FINISH.MAX_TOKENS,
      text: "partial",
    });
  });

  it("uses the exact upstream error.message on the Claude error terminal", () => {
    const out = claudeDirect(completion(OPENAI_FINISH.ERROR, textMessage("boom"), {
      error: { message: "provider blew up" },
    }));
    expectClaudeErrorTerminal(out, "provider blew up");
  });
});

describe("#1330 robustness — match main for non-error / malformed inputs", () => {
  it.each([null, undefined])(
    "does not throw or emit an error terminal when finish_reason is %j",
    (finish) => {
      const body = completion(finish, textMessage("hi"));
      expect(() => {
        expectClaudeMessage(claudeDirect(structuredClone(body)), {
          stop_reason: CLAUDE_STOP.END_TURN,
          text: "hi",
        });
        expectGeminiResponse(geminiDirect(structuredClone(body)), {
          finishReason: GEMINI_FINISH.STOP,
          text: "hi",
        });
      }).not.toThrow();
    },
  );

  it.each(["", "foo"])(
    "does not throw or emit new terminals when finish_reason is empty/unknown %j",
    (finish) => {
      const body = completion(finish, textMessage("hi"));
      expect(() => {
        expectClaudeMessage(claudeDirect(structuredClone(body)), {
          stop_reason: CLAUDE_STOP.END_TURN,
          text: "hi",
        });
        expectGeminiResponse(geminiDirect(structuredClone(body)), {
          finishReason: GEMINI_FINISH.STOP,
          text: "hi",
        });
      }).not.toThrow();
    },
  );

  it.each([5, true])(
    "does not throw or forward primitive finish_reason %j as a new terminal",
    (finish) => {
      const body = completion(finish, textMessage("hi"));
      expect(() => {
        expectClaudeMessage(claudeDirect(structuredClone(body)), {
          stop_reason: CLAUDE_STOP.END_TURN,
          text: "hi",
        });
        expectGeminiResponse(geminiDirect(structuredClone(body)), {
          finishReason: GEMINI_FINISH.STOP,
          text: "hi",
        });
      }).not.toThrow();
    },
  );

  it.each([
    ["null", null],
    ["string", "boom"],
    ["number", 5],
    ["boolean", true],
    ["empty object", {}],
    ["empty message", { message: "" }],
    ["empty code", { code: "" }],
  ])(
    "does not throw when finish_reason is error and upstream error is %s",
    (_label, error) => {
      const body = completion(OPENAI_FINISH.ERROR, textMessage("boom"), { error });
      expect(() => {
        expectClaudeErrorTerminal(
          claudeDirect(structuredClone(body)),
          DEFAULT_CLAUDE_ABORT_MESSAGE,
        );
        expectGeminiResponse(geminiDirect(structuredClone(body)), {
          finishReason: GEMINI_FINISH.OTHER,
          text: "boom",
        });
      }).not.toThrow();
    },
  );

  it("passthroughs bodies with no choices without throwing", () => {
    const empty = { id: "x", object: "chat.completion", choices: [] };
    const missing = { id: "x", object: "chat.completion" };
    expect(() => {
      expect(claudeDirect(empty)).toEqual(empty);
      expect(geminiDirect(empty)).toEqual(empty);
      expect(claudeDirect(missing)).toEqual(missing);
      expect(geminiDirect(missing)).toEqual(missing);
    }).not.toThrow();
  });

  it("passthroughs choices:[null] without throwing or inventing a terminal", () => {
    const body = { id: "x", object: "chat.completion", choices: [null] };
    expect(() => {
      expect(claudeDirect(body)).toEqual(body);
      expect(geminiDirect(body)).toEqual(body);
    }).not.toThrow();
  });
});
