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
 */

const CHAT = FORMATS.OPENAI;
const CLAUDE = FORMATS.CLAUDE;
const GEMINI = FORMATS.GEMINI;

const completion = (finish_reason, message, extra = {}) => ({
  id: "chat-1330",
  model: "m",
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

  it("uses a non-empty upstream error.message on the Claude error terminal", () => {
    const out = claudeDirect(completion(OPENAI_FINISH.ERROR, textMessage("boom"), {
      error: { message: "provider blew up" },
    }));
    expect(out).toMatchObject({
      type: "error",
      error: { type: "api_error", message: "provider blew up" },
    });
  });
});

describe("#1330 robustness — match main for non-error / malformed inputs", () => {
  it.each([null, undefined])(
    "does not throw or emit an error terminal when finish_reason is %j",
    (finish) => {
      const body = completion(finish, textMessage("hi"));
      expect(() => {
        const claude = claudeDirect(structuredClone(body));
        expect(claude).toMatchObject({ type: "message", stop_reason: CLAUDE_STOP.END_TURN });
        expect(claude.type).not.toBe("error");

        const gemini = geminiDirect(structuredClone(body));
        expect(gemini.response.candidates[0].finishReason).toBe(GEMINI_FINISH.STOP);
      }).not.toThrow();
    },
  );

  it.each(["", "foo"])(
    "does not throw or emit new terminals when finish_reason is empty/unknown %j",
    (finish) => {
      const body = completion(finish, textMessage("hi"));
      expect(() => {
        const claude = claudeDirect(structuredClone(body));
        expect(claude).toMatchObject({ type: "message", stop_reason: CLAUDE_STOP.END_TURN });
        expect(claude.type).not.toBe("error");

        const gemini = geminiDirect(structuredClone(body));
        expect(gemini.response.candidates[0].finishReason).toBe(GEMINI_FINISH.STOP);
      }).not.toThrow();
    },
  );

  it.each([5, true])(
    "does not throw or forward primitive finish_reason %j as a new terminal",
    (finish) => {
      const body = completion(finish, textMessage("hi"));
      expect(() => {
        const claude = claudeDirect(structuredClone(body));
        expect(claude).toMatchObject({ type: "message", stop_reason: CLAUDE_STOP.END_TURN });
        expect(claude.type).not.toBe("error");

        const gemini = geminiDirect(structuredClone(body));
        expect(gemini.response.candidates[0].finishReason).toBe(GEMINI_FINISH.STOP);
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
        const claude = claudeDirect(structuredClone(body));
        expect(claude).toMatchObject({
          type: "error",
          error: { type: "api_error", message: expect.any(String) },
        });
        expect(claude.error.message.length).toBeGreaterThan(0);

        const gemini = geminiDirect(structuredClone(body));
        expect(gemini.response.candidates[0].finishReason).toBe(GEMINI_FINISH.OTHER);
      }).not.toThrow();
    },
  );

  it("passthroughs bodies with no choices without throwing", () => {
    const empty = { id: "x", object: "chat.completion", choices: [] };
    const missing = { id: "x", object: "chat.completion" };
    expect(() => {
      expect(claudeDirect(empty)).toBe(empty);
      expect(geminiDirect(empty)).toBe(empty);
      expect(claudeDirect(missing)).toBe(missing);
      expect(geminiDirect(missing)).toBe(missing);
    }).not.toThrow();
  });

  it("passthroughs choices:[null] without throwing or inventing a terminal", () => {
    const body = { id: "x", object: "chat.completion", choices: [null] };
    expect(() => {
      expect(claudeDirect(body)).toBe(body);
      expect(geminiDirect(body)).toBe(body);
    }).not.toThrow();
  });
});
