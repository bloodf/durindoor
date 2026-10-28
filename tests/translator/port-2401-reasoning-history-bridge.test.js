// Regression coverage for upstream decolua/9router#2401: readable reasoning
// survives the OpenAI bridge, but opaque Claude history must reject with 400.
// Only compatible native routes can preserve redacted_thinking continuity.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

// Neutral model id — the bridge logic under test is format-driven, not model-driven.
const MODEL = "test-model";

describe("#2401 reasoning/thinking bridge (request)", () => {
  it("claude -> openai -> claude roundtrip preserves thinking blocks exactly once", () => {
    const body = {
      system: "sys",
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "roundtrip reasoning", signature: "sig-1" },
          { type: "text", text: "roundtrip answer" },
        ] },
      ],
    };
    const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true);
    const assistant = mid.messages.find((m) => m.role === "assistant");
    expect(assistant.reasoning_content).toBe("roundtrip reasoning");

    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, mid, true, {}, "anthropic-compatible");
    const back = final.messages.find((m) => m.role === "assistant");
    const thinkingBlocks = back.content.filter((b) => b.type === "thinking");
    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0].thinking).toBe("roundtrip reasoning");
    // Thinking must precede the text block (Claude requires thinking first).
    expect(back.content[0].type).toBe("thinking");
    expect(back.content.find((b) => b.type === "text").text).toBe("roundtrip answer");
  });

  it("rejects mixed redacted_thinking history instead of using an in-process bridge", () => {
    const redacted = { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque-encrypted-payload-AAA" };
    const body = {
      system: "sys",
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [
          { type: "thinking", thinking: "visible reasoning", signature: "sig-2" },
          redacted,
          { type: "text", text: "answer" },
        ] },
      ],
    };
    expect(() => translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true))
      .toThrow(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining("redacted_thinking"),
      }));
  });

  it("rejects redacted_thinking alongside tool calls before bridging", () => {
    const redacted = { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque-encrypted-payload-BBB" };
    const body = {
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [
          redacted,
          { type: "tool_use", id: "call_1", name: "Read", input: { path: "x" } },
        ] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
      ],
    };
    expect(() => translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true))
      .toThrow(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining("redacted_thinking"),
      }));
  });

  it("rejects a redacted-only assistant turn rather than silently dropping it", () => {
    const redacted = { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque-encrypted-payload-CCC" };
    const body = {
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [redacted] },
      ],
    };
    expect(() => translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true))
      .toThrow(expect.objectContaining({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: expect.stringContaining("redacted_thinking"),
      }));
  });

  it("openai -> claude: reasoning_content becomes a leading thinking block (no redacted metadata)", () => {
    const body = {
      messages: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1", reasoning_content: "r1" },
        { role: "user", content: "u2" },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, body, true, {}, "anthropic-compatible");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "r1", signature: DEFAULT_THINKING_CLAUDE_SIGNATURE });
    expect(assistant.content[1]).toMatchObject({ type: "text", text: "a1" });
    expect(assistant.content.some((b) => b.type === "redacted_thinking")).toBe(false);
  });
});

describe.each(["claude", "anthropic-compatible"])("#2401 native opaque history (%s)", (provider) => {
  describe.each(["claude-sonnet-4-5", "claude-sonnet-4-6"])("model=%s", (model) => {
    it.each(["translateRequest", "normalizeClaudePassthrough"])("%s preserves opaque order without a thinking placeholder", (route) => {
      const content = [
        { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "payload-1" },
        { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "" },
        { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "payload-2" },
        { type: CLAUDE_BLOCK.TOOL_USE, id: "call_1", name: "Read", input: { path: "x" } },
      ];
      const body = {
        model,
        max_tokens: 4096,
        thinking: { type: "enabled", budget_tokens: 1024 },
        messages: [
          { role: ROLE.USER, content: "read x" },
          { role: ROLE.ASSISTANT, content: structuredClone(content) },
          { role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: "call_1", content: "ok" }] },
        ],
      };
      const out = route === "translateRequest"
        ? translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, body, true, null, provider)
        : normalizeClaudePassthrough(body, model, provider);
      const assistant = out.messages.find((message) => message.role === ROLE.ASSISTANT);
      expect(assistant.content.map(({ cache_control, ...block }) => block)).toEqual(content);
    });

    it("keeps readable signature policy separate from opaque history", () => {
      const opaque = { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque" };
      const readable = { type: CLAUDE_BLOCK.THINKING, thinking: "unsigned reasoning" };
      const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, model, {
        model,
        messages: [
          { role: ROLE.ASSISTANT, content: [structuredClone(opaque), { ...readable }, { ...opaque, data: "" }] },
          { role: ROLE.USER, content: "continue" },
        ],
      }, true, null, provider);
      expect(out.messages.find((message) => message.role === ROLE.ASSISTANT).content).toEqual([
        opaque,
        ...(provider === "claude" ? [] : [{ ...readable, signature: DEFAULT_THINKING_CLAUDE_SIGNATURE }]),
        { ...opaque, data: "" },
      ]);
    });
  });
});

describe("#2401 reasoning/thinking bridge (response)", () => {
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

  it("openai -> claude response: reasoning_content streams as thinking_delta, not text", () => {
    const state = freshState();
    const out1 = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk({ role: "assistant", content: null, reasoning_content: "deep thought" }), state);
    const thinkingDelta = out1.find((e) => e?.delta?.type === "thinking_delta");
    expect(thinkingDelta).toBeTruthy();
    expect(thinkingDelta.delta.thinking).toContain("deep thought");
    expect(out1.some((e) => e?.delta?.type === "text_delta")).toBe(false);

    const out2 = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk({ content: "visible answer" }), state);
    const textDelta = out2.find((e) => e?.delta?.type === "text_delta");
    expect(textDelta).toBeTruthy();
    expect(textDelta.delta.text).toContain("visible answer");
    // The thinking block opened by the reasoning chunk must be closed before text.
    expect(out2.some((e) => e?.type === "content_block_stop")).toBe(true);
  });
});

describe("#2401 redacted_thinking bridge adversarial boundaries", () => {
  it.each([
    ["empty data", [
      { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "" },
      { type: CLAUDE_BLOCK.TEXT, text: "answer" },
    ]],
    ["multiple interleaved blocks", [
      { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "payload-1" },
      { type: CLAUDE_BLOCK.THINKING, thinking: "some reasoning", signature: "sig" },
      { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "payload-2" },
      { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "payload-3" },
      { type: CLAUDE_BLOCK.TEXT, text: "answer" },
    ]],
    ["thinking before redaction", [
      { type: CLAUDE_BLOCK.THINKING, thinking: "visible reasoning", signature: "sig-mixed" },
      { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque-mixed" },
      { type: CLAUDE_BLOCK.TEXT, text: "the answer" },
    ]],
    ["opaque wire payload", [
      { type: CLAUDE_BLOCK.REDACTED_THINKING, data: "opaque-no-leak" },
      { type: CLAUDE_BLOCK.TEXT, text: "answer" },
    ]],
  ])("rejects %s before creating a lossy OpenAI wire body", (_label, content) => {
    expect(() => translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, {
      max_tokens: 100,
      messages: [
        { role: ROLE.USER, content: "u" },
        { role: ROLE.ASSISTANT, content },
        { role: ROLE.USER, content: "continue" },
      ],
    }, true)).toThrow(expect.objectContaining({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: expect.stringContaining("redacted_thinking"),
    }));
  });
});
