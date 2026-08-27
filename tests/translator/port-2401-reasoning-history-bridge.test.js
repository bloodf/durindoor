// Regression coverage for upstream decolua/9router#2401 — reasoning/thinking
// history must survive the OpenAI request bridge. The OpenAI Chat Completions
// wire format has no native thinking field for request *history*, so the bridge
// carries normal thinking as `reasoning_content` and redacted_thinking blocks
// as non-serializable metadata on the intermediate assistant message. Once
// dropped on one hop, thinking content is gone for good on every subsequent hop
// (combo switch, retry, translation).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

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

    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, mid, true, {}, "anthropic");
    const back = final.messages.find((m) => m.role === "assistant");
    const thinkingBlocks = back.content.filter((b) => b.type === "thinking");
    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0].thinking).toBe("roundtrip reasoning");
    // Thinking must precede the text block (Claude requires thinking first).
    expect(back.content[0].type).toBe("thinking");
    expect(back.content.find((b) => b.type === "text").text).toBe("roundtrip answer");
  });

  it("claude -> openai -> claude roundtrip preserves redacted_thinking blocks losslessly", () => {
    const redacted = { type: "redacted_thinking", data: "opaque-encrypted-payload-AAA" };
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
    const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true);
    const assistant = mid.messages.find((m) => m.role === "assistant");

    // The opaque redacted payload must NOT be flattened into reasoning_content:
    // that would leak encrypted bytes as plain text and lose the block type.
    expect(assistant.reasoning_content).toBe("visible reasoning");

    // Redacted metadata is in-process only: serializing the intermediate body
    // (what an OpenAI-final provider would send) must expose no trace of it.
    const serialized = JSON.parse(JSON.stringify(mid));
    const serializedAssistant = serialized.messages.find((m) => m.role === "assistant");
    expect(JSON.stringify(serializedAssistant)).not.toContain("redacted_thinking");
    expect(JSON.stringify(serializedAssistant)).not.toContain("opaque-encrypted-payload-AAA");

    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, mid, true, {}, "anthropic");
    const back = final.messages.find((m) => m.role === "assistant");
    const redactedBack = back.content.filter((b) => b.type === "redacted_thinking");
    expect(redactedBack).toHaveLength(1);
    expect(redactedBack[0]).toEqual({ type: "redacted_thinking", data: "opaque-encrypted-payload-AAA" });
    // Normal thinking still survives alongside the redacted block.
    expect(back.content.filter((b) => b.type === "thinking")).toHaveLength(1);
  });

  it("redacted_thinking roundtrip holds for an assistant message that also carries tool_calls", () => {
    const redacted = { type: "redacted_thinking", data: "opaque-encrypted-payload-BBB" };
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
    const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true);
    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, mid, true, {}, "anthropic");
    const back = final.messages.find((m) => m.role === "assistant");
    const redactedBack = back.content.filter((b) => b.type === "redacted_thinking");
    expect(redactedBack).toHaveLength(1);
    expect(redactedBack[0]).toEqual(redacted);
    expect(back.content.some((b) => b.type === "tool_use")).toBe(true);
  });

  it("claude -> openai -> claude roundtrip keeps a redacted-only assistant turn alive", () => {
    const redacted = { type: "redacted_thinking", data: "opaque-encrypted-payload-CCC" };
    const body = {
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: [redacted] },
      ],
    };
    const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true);
    // The intermediate assistant message must exist (not dropped as null) and
    // must expose nothing about the redacted payload on the wire.
    const assistant = mid.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant.reasoning_content ?? "").not.toContain("opaque-encrypted-payload-CCC");

    // This case isolates the in-process redacted-thinking carrier. Preserve the
    // terminal assistant deliberately; default continuation behavior is covered
    // by the translated/native assistant-prefill-policy regression suite.
    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, mid, true, {
      rawHeaders: { "x-9router-assistant-prefill": "preserve" },
    }, "anthropic");
    const back = final.messages.find((m) => m.role === "assistant");
    expect(back).toBeTruthy();
    expect(back.content).toEqual([{ type: "redacted_thinking", data: "opaque-encrypted-payload-CCC" }]);
  });

  it("openai -> claude: reasoning_content becomes a leading thinking block (no redacted metadata)", () => {
    const body = {
      messages: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1", reasoning_content: "r1" },
        { role: "user", content: "u2" },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, body, true, {}, "anthropic");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "r1" });
    expect(assistant.content[1]).toMatchObject({ type: "text", text: "a1" });
    expect(assistant.content.some((b) => b.type === "redacted_thinking")).toBe(false);
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
  const roundtripAssistant = (assistantContent) => {
    const body = {
      max_tokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "u" }] },
        { role: "assistant", content: assistantContent },
      ],
    };
    const mid = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, MODEL, body, true);
    const final = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, MODEL, mid, true, {}, "anthropic");
    return { mid, back: final.messages.find((m) => m.role === "assistant") };
  };

  it("roundtrips a redacted_thinking block with an empty data string losslessly", () => {
    const { mid, back } = roundtripAssistant([
      { type: "redacted_thinking", data: "" },
      { type: "text", text: "answer" },
    ]);
    // Empty data is still a well-formed block (typeof data === "string"): it
    // must survive the bridge, not be silently dropped.
    expect(mid.messages.some((m) => m.role === "assistant")).toBe(true);
    expect(back).toBeTruthy();
    expect(back.content.filter((b) => b.type === "redacted_thinking")).toEqual([
      { type: "redacted_thinking", data: "" },
    ]);
    expect(back.content.some((b) => b.type === "text" && b.text === "answer")).toBe(true);
    // Redacted block restored before the text block.
    const types = back.content.map((b) => b.type);
    expect(types.indexOf("redacted_thinking")).toBeLessThan(types.indexOf("text"));
  });

  it("preserves the relative order of multiple redacted_thinking blocks in one turn", () => {
    const { back } = roundtripAssistant([
      { type: "redacted_thinking", data: "payload-1" },
      { type: "thinking", thinking: "some reasoning", signature: "sig" },
      { type: "redacted_thinking", data: "payload-2" },
      { type: "redacted_thinking", data: "payload-3" },
      { type: "text", text: "answer" },
    ]);
    const redactedBack = back.content.filter((b) => b.type === "redacted_thinking");
    expect(redactedBack).toEqual([
      { type: "redacted_thinking", data: "payload-1" },
      { type: "redacted_thinking", data: "payload-2" },
      { type: "redacted_thinking", data: "payload-3" },
    ]);
    // Original interleaving with the thinking block is intentionally NOT
    // preserved (see ponytail note on CLAUDE_REDACTED_THINKING_BLOCKS in
    // open-sse/translator/schema/blocks.js): all redacted blocks are restored
    // ahead of the thinking block rebuilt from reasoning_content.
    const types = back.content.map((b) => b.type);
    expect(types.indexOf("thinking")).toBeGreaterThan(types.lastIndexOf("redacted_thinking"));
  });

  it("restores redacted blocks ahead of the rebuilt thinking block in a mixed turn", () => {
    const { back } = roundtripAssistant([
      { type: "thinking", thinking: "visible reasoning", signature: "sig-mixed" },
      { type: "redacted_thinking", data: "opaque-mixed" },
      { type: "text", text: "the answer" },
    ]);
    expect(back.content.filter((b) => b.type === "redacted_thinking")).toEqual([
      { type: "redacted_thinking", data: "opaque-mixed" },
    ]);
    expect(back.content.filter((b) => b.type === "thinking")).toEqual([
      { type: "thinking", thinking: "visible reasoning" },
    ]);
    expect(back.content.some((b) => b.type === "text" && b.text === "the answer")).toBe(true);
    // Restore order: redacted prepended, then rebuilt thinking, then text.
    const types = back.content.map((b) => b.type);
    expect(types).toEqual(["redacted_thinking", "thinking", "text"]);
  });

  it("never leaks the symbol carrier onto the wire (JSON, spread, and own-key checks)", () => {
    const { mid } = roundtripAssistant([
      { type: "redacted_thinking", data: "opaque-no-leak" },
      { type: "text", text: "answer" },
    ]);
    const assistant = mid.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();

    // JSON.stringify of the intermediate message (what an OpenAI-final
    // provider would send) must contain no trace of the stashed payload.
    const json = JSON.stringify(assistant);
    expect(json).not.toContain("opaque-no-leak");
    expect(json).not.toContain("redacted_thinking");

    // The carrier must not appear in any string-keyed enumeration path.
    expect(Object.keys(assistant)).not.toContain("claudeRedactedThinkingBlocks");
    expect(Object.getOwnPropertyNames(assistant)).toEqual(
      expect.not.arrayContaining(["claudeRedactedThinkingBlocks"]),
    );

    // A spread copy ({ ...msg }) drops symbol-keyed non-enumerable props, so
    // a downstream spread cannot smuggle the payload into a wire body either.
    const spread = { ...assistant };
    expect(JSON.stringify(spread)).not.toContain("opaque-no-leak");
    expect(JSON.parse(JSON.stringify(spread))).toEqual(JSON.parse(json));
  });
});
