// Issue 2541: every buffer a response translator retains counts against the
// per-stream budget, and dropping a buffer gives its share back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const CAP = 100;
const LIMIT = /retained size limit/;
const text40 = "x".repeat(40);

const chat = (delta, finish = null) => ({
  id: "chatcmpl-12345678",
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const toolArgs = (args) => chat({ tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: args } }] });

/** Send `count` frames (built from their position) through one translator state. */
function feed(from, to, frame, count, state = initState(to)) {
  for (let i = 0; i < count; i++) translateResponse(from, to, frame(i), state);
  return state;
}

const blockStart = (index, content_block) => ({ type: "content_block_start", index, content_block });
const blockDelta = (index, delta) => ({ type: "content_block_delta", index, delta });
const textStart = (index) => blockStart(index, { type: "text", text: "" });

const claude = (frame, count, state) => feed(FORMATS.CLAUDE, FORMATS.OPENAI, frame, count, state);
const geminiPart = (part) => ({ responseId: "r1", candidates: [{ content: { parts: [part] } }] });

describe("retained stream budget covers every translator buffer (issue 2541)", () => {
  beforeEach(() => vi.stubEnv("STREAM_MAX_RETAINED_BYTES", String(CAP)));
  afterEach(() => vi.unstubAllEnvs());

  describe("claude → openai", () => {
    it.each([
      ["redacted_thinking data", { type: "redacted_thinking", data: text40 }],
      ["initial thinking", { type: "thinking", thinking: text40 }],
      ["initial signature", { type: "thinking", signature: text40 }],
    ])("charges block-start %s", (_label, block) => {
      expect(() => claude((i) => blockStart(i, block), 5)).toThrow(LIMIT);
    });

    it("frees released thinking for later content", () => {
      const state = initState(FORMATS.OPENAI);
      for (let i = 0; i < 20; i += 2) {
        claude(() => blockStart(i, { type: "thinking", thinking: "" }), 1, state);
        claude(() => blockDelta(i, { type: "thinking_delta", thinking: text40 }), 1, state);
        claude(() => blockStart(i + 1, { type: "text", text: "" }), 1, state);
      }
      claude(() => blockStart(30, { type: "thinking", thinking: "" }), 1, state);
      expect(() => claude(() => blockDelta(30, { type: "thinking_delta", thinking: text40 }), 3, state)).toThrow(LIMIT);
    });

    it("does not charge a replaced block index twice", () => {
      const state = claude(() => blockStart(0, { type: "redacted_thinking", data: text40 }), 10);
      expect(state.claudeThinkingBlocks.size).toBe(1);
    });

    it("keeps no plain text", () => {
      const state = claude(() => textStart(0), 1);
      expect(() => claude(() => blockDelta(0, { type: "text_delta", text: text40 }), 10, state)).not.toThrow();
    });
  });

  describe("chat → responses", () => {
    const run = (frame, count) => feed(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, frame, count);

    it.each([
      ["answer text", () => chat({ content: text40 })],
      ["reasoning", () => chat({ reasoning_content: text40 })],
      ["tool arguments", () => toolArgs(text40)],
      ["tool names", (i) => chat({ tool_calls: [{ index: i, id: `c${i}`, function: { name: text40 } }] })],
    ])("stops past the budget for %s", (_label, frame) => {
      expect(() => run(frame, 5)).toThrow(LIMIT);
    });

    it("charges the encrypted reasoning signature once per replacement", () => {
      expect(() => run(() => chat({ reasoning_encrypted_content: text40 }), 10)).not.toThrow();
      expect(() => run(() => chat({ reasoning_encrypted_content: "s".repeat(CAP + 1) }), 1)).toThrow(LIMIT);
    });

    it("charges text the inline <think> extractor holds back", () => {
      const state = initState(FORMATS.OPENAI_RESPONSES);
      state.provider = "minimax";
      state.requestedModel = "MiniMax-M3";
      const send = (content, count) => feed(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, () => chat({ content }), count, state);
      send("<think>", 1);
      expect(() => send(text40, 5)).toThrow(LIMIT);
    });
  });

  describe("responses → chat", () => {
    const run = (frame, count, state) => feed(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, frame, count, state);
    const textDelta = () => ({ type: "response.output_text.delta", item_id: "m1", output_index: 0, delta: text40 });

    it("stops past the budget for answer text tracked for snapshots", () => {
      expect(() => run(textDelta, 5)).toThrow(LIMIT);
    });

    it("charges text recovered from a finished item", () => {
      const done = (i) => ({
        type: "response.output_item.done",
        output_index: i,
        item: { id: `m${i}`, type: "message", role: "assistant", content: [{ type: "output_text", text: text40 }] },
      });
      expect(() => run(done, 5)).toThrow(LIMIT);
    });

    it("frees tracked text when the response ends or restarts", () => {
      const state = initState(FORMATS.OPENAI);
      for (let i = 0; i < 5; i++) {
        run(() => ({ type: "response.created", response: {} }), 1, state);
        expect(() => run(textDelta, 2, state)).not.toThrow();
      }
    });

    it("frees buffered custom tool input when the response restarts", () => {
      const state = initState(FORMATS.OPENAI);
      const added = { type: "response.output_item.added", output_index: 0, item: { id: "i1", call_id: "c1", type: "custom_tool_call", name: "p" } };
      for (let i = 0; i < 5; i++) {
        run(() => ({ type: "response.created", response: {} }), 1, state);
        run(() => added, 1, state);
        expect(() => run(() => ({ type: "response.custom_tool_call_input.delta", item_id: "i1", delta: text40 }), 2, state)).not.toThrow();
      }
    });
  });

  describe("responses → claude", () => {
    // Hosted search selects the direct route, which also keeps search evidence.
    const run = (frame, count) =>
      feed(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, frame, count, { ...initState(FORMATS.CLAUDE), searchEnabled: true });

    it.each([
      ["answer text", () => ({ type: "response.output_text.delta", item_id: "m1", output_index: 0, delta: text40 })],
      ["citations", (i) => ({ type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: `https://e.test/${i}` } })],
    ])("stops past the budget for %s", (_label, frame) => {
      expect(() => run(frame, 6)).toThrow(LIMIT);
    });

    it("charges a repeated citation once", () => {
      const frame = () => ({ type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://e.test/a" } });
      expect(() => run(frame, 10)).not.toThrow();
    });
  });

  describe("chat → claude", () => {
    const run = (frame, count) => feed(FORMATS.OPENAI, FORMATS.CLAUDE, frame, count);

    it.each([
      ["tool arguments", () => toolArgs(text40)],
      ["tool call headers", (i) => chat({ tool_calls: [{ index: i, id: `call_${i}`, function: { name: text40 } }] })],
    ])("stops past the budget for %s", (_label, frame) => {
      expect(() => run(frame, 5)).toThrow(LIMIT);
    });
  });

  describe("kiro → claude", () => {
    const run = (frame, count) => feed(FORMATS.KIRO, FORMATS.CLAUDE, frame, count);

    it("stops past the budget for tool arguments", () => {
      expect(() => run((i) => toolArgs(`${i}`.repeat(40)), 5)).toThrow(LIMIT);
    });

    it("stops past the budget for tool call headers", () => {
      expect(() => run((i) => chat({ tool_calls: [{ index: i, id: `c${i}`, function: { name: text40 } }] }), 5)).toThrow(LIMIT);
    });
  });

  describe("chat → antigravity", () => {
    const run = (frame, count, state) => feed(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, frame, count, state);

    it("stops past the budget for tool call ids", () => {
      expect(() => run((i) => chat({ tool_calls: [{ index: i, id: `${i}${text40}` }] }), 5)).toThrow(LIMIT);
    });

    it("frees emitted tool calls", () => {
      const state = initState(FORMATS.ANTIGRAVITY);
      for (let i = 0; i < 10; i++) {
        run(() => toolArgs(text40), 1, state);
        expect(() => run(() => chat({}, "tool_calls"), 1, state)).not.toThrow();
      }
    });
  });

  describe("commandcode → openai", () => {
    it("stops past the budget for buffered tool calls", () => {
      const call = (i) => ({ type: "tool-call", toolCallId: `c${i}`, toolName: "f", input: { a: text40 } });
      expect(() => feed(FORMATS.COMMANDCODE, FORMATS.OPENAI, call, 5)).toThrow(LIMIT);
    });
  });

  describe("ollama → openai", () => {
    it("retains no text or thinking", () => {
      const frame = () => ({ model: "m", message: { content: text40, thinking: text40 }, done: false });
      const state = feed(FORMATS.OLLAMA, FORMATS.OPENAI, frame, 10);
      expect(JSON.stringify(state)).not.toContain(text40);
    });
  });

  describe("gemini → claude", () => {
    const run = (frame, count, state) => feed(FORMATS.GEMINI, FORMATS.CLAUDE, frame, count, state);
    const signature = () => geminiPart({ thoughtSignature: text40 });

    it("stops past the budget for queued signatures", () => {
      expect(() => run(signature, 5)).toThrow(LIMIT);
    });

    it("frees a signature once a function call takes it", () => {
      const state = initState(FORMATS.CLAUDE);
      for (let i = 0; i < 10; i++) {
        run(signature, 1, state);
        expect(() => run(() => geminiPart({ functionCall: { name: "f", args: {} } }), 1, state)).not.toThrow();
      }
    });
  });

  describe("gemini → openai", () => {
    const run = (frame, count) => feed(FORMATS.GEMINI, FORMATS.OPENAI, frame, count);

    it("holds one pending signature at a time", () => {
      expect(() => run(() => geminiPart({ thoughtSignature: text40 }), 10)).not.toThrow();
      expect(() => run(() => geminiPart({ thoughtSignature: "s".repeat(CAP + 1) }), 1)).toThrow(LIMIT);
    });

    it("stops past the budget for remembered tool call ids", () => {
      const call = (i) => geminiPart({ functionCall: { id: `${i}${text40}`, name: "f", args: {} } });
      expect(() => run(call, 5)).toThrow(LIMIT);
    });
  });
});
