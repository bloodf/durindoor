import { describe, expect, it } from "vitest";
import { anchorClaudeCache, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

// These cases isolate system-turn folding/hoisting and intentionally assert the
// pre-policy assistant shape. Opt out explicitly; default trailing-assistant
// normalization is covered for both paths in assistant-prefill-policy.test.js.
const PRESERVE_ASSISTANT_PREFILL = { rawHeaders: { "x-9router-assistant-prefill": "preserve" } };

describe("Claude passthrough cache-control anchoring", () => {
  it("re-anchors markers after preparation reshapes messages", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "old", cache_control: { type: "ephemeral" } },
            { type: "thinking", thinking: "hidden", cache_control: { type: "ephemeral" } },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "final", cache_control: { type: "ephemeral" } },
            { type: "redacted_thinking", data: "hidden", cache_control: { type: "ephemeral" } },
          ],
        },
        { role: "user", content: [{ type: "text", text: "next", cache_control: { type: "ephemeral" } }] },
      ],
    };

    anchorClaudeCache(body);

    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(body.messages[0].content[1].cache_control).toBeUndefined();
    expect(body.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[1].content[1].cache_control).toBeUndefined();
    expect(body.messages[2].content[0].cache_control).toBeUndefined();
  });

  it("keeps only final system and tool cache breakpoints at one hour", () => {
    const body = {
      system: [
        { type: "text", text: "base", cache_control: { type: "ephemeral" } },
        { type: "text", text: "final", cache_control: { type: "ephemeral" } },
      ],
      tools: [
        { name: "first", cache_control: { type: "ephemeral" } },
        { name: "last", cache_control: { type: "ephemeral" } },
      ],
    };

    anchorClaudeCache(body);

    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("unconditionally strips cache_control from every message block before anchoring", () => {
    // Defends against ad-hoc cache_control clients may leave mid-history; the
    // anchor sweep must remove all of it so the prefix gets exactly one fresh
    // breakpoint, even on non-cache-eligible blocks like images.
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "u1", cache_control: { type: "ephemeral" } }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "a1", cache_control: { type: "ephemeral", ttl: "1h" } },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" }, cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    };

    anchorClaudeCache(body);

    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(body.messages[1].content[0].cache_control).toBeUndefined();
    // Last assistant block (image) wins the anchor.
    expect(body.messages[1].content[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("converts a string-content message to a text block before anchoring", () => {
    // Anthropic accepts either string content or content blocks; the anchor
    // sweep must handle the string shape without crashing and still stamp it.
    const body = {
      messages: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "answer" },
      ],
    };

    anchorClaudeCache(body);

    expect(body.messages[1].content).toMatchObject([{ type: "text", text: "answer" }]);
    expect(body.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("normalizeClaudePassthrough default behavior (foldSystemTurns off)", () => {
  it("hoists mid-conversation system messages to top-level system (GitHub/Ollama callers)", () => {
    const body = {
      messages: [
        { role: "user", content: "first" },
        { role: "system", content: "volatile reminder" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, PRESERVE_ASSISTANT_PREFILL);

    expect(body.system).toEqual([{ type: "text", text: "volatile reminder" }]);
    expect(body.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("preserves a string body.system when hoisting mid-conversation system messages", () => {
    const body = {
      system: "primary system prompt",
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null);

    expect(body.system).toEqual([
      { type: "text", text: "primary system prompt" },
      { type: "text", text: "be brief" },
    ]);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("drops non-text blocks while hoisting mid-conversation system messages", () => {
    const body = {
      messages: [
        { role: "user", content: "ask" },
        { role: "system", content: [
          { type: "text", text: "instruction" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
        ] },
        { role: "user", content: "answer" },
      ],
    };

    normalizeClaudePassthrough(body);

    expect(body.system).toEqual([{ type: "text", text: "instruction" }]);
    expect(body.messages).toEqual([
      { role: "user", content: "ask" },
      { role: "user", content: "answer" },
    ]);
  });
});

describe("normalizeClaudePassthrough foldSystemTurns: true (native chatCore passthrough)", () => {
  it("folds mid-conversation system text into the next user turn after its existing content", () => {
    const body = {
      system: [{ type: "text", text: "stable" }],
      messages: [
        { role: "user", content: "first" },
        { role: "system", content: "volatile reminder" },
        { role: "user", content: "second" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { ...PRESERVE_ASSISTANT_PREFILL, foldSystemTurns: true });

    // Top-level system must NOT pick up the volatile system message.
    expect(body.system).toEqual([{ type: "text", text: "stable" }]);
    // The volatile reminder lands INSIDE the next user turn, after its existing content.
    expect(body.messages).toEqual([
      { role: "user", content: "first" },
      {
        role: "user",
        content: [
          { type: "text", text: "second" },
          { type: "text", text: "volatile reminder" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("preserves tool_result blocks when folding the system reminder into a user turn", () => {
    // Real Anthropic exchanges put tool_result blocks first in the user turn.
    // The folded system reminder must NOT be inserted ahead of them.
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "ask" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] },
        { role: "system", content: "remember: be brief" },
        { role: "user", content: "followup question" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { ...PRESERVE_ASSISTANT_PREFILL, foldSystemTurns: true });

    // System reminder must attach to the FOLLOWING user turn, not the tool_result one.
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "ask" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "followup question" },
          { type: "text", text: "remember: be brief" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("folds all blocks (text and non-text) from a mid-conversation system message into the next user turn, never leaving a system role behind", () => {
    // Some clients may include image blocks in a "system" role message.
    // The Anthropic Messages API does not allow role:"system" inside messages,
    // so the fold must move the image into the next existing user turn
    // alongside any text. No synthesized user turn is created; if the image
    // arrives with no following user turn, it is dropped with the text.
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "describe" }] },
        {
          role: "system",
          content: [
            { type: "text", text: "hint: focus on color" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
          ],
        },
        { role: "user", content: "what do you see?" },
        { role: "assistant", content: [{ type: "text", text: "red" }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { ...PRESERVE_ASSISTANT_PREFILL, foldSystemTurns: true });

    // No synthesized standalone user turn; the next existing user turn absorbs everything.
    expect(body.messages).toHaveLength(3);
    expect(body.messages.every((m) => m.role !== "system")).toBe(true);
    expect(body.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "describe" }] });
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what do you see?" },
        { type: "text", text: "hint: focus on color" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
      ],
    });
    expect(body.messages[2]).toEqual({ role: "assistant", content: [{ type: "text", text: "red" }] });
  });

  it("emits zero system-role messages after fold (Anthropic Messages contract)", () => {
    // A system message followed by no further user turn must not leave a
    // system role behind. The text+image blocks drop with the system turn
    // because there is no following user turn to absorb them.
    const body = {
      messages: [
        { role: "user", content: "ask" },
        { role: "system", content: [{ type: "text", text: "volatile" }] },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { ...PRESERVE_ASSISTANT_PREFILL, foldSystemTurns: true });

    expect(body.messages.every((m) => m.role !== "system")).toBe(true);
    expect(body.messages).toEqual([
      { role: "user", content: "ask" },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("drops assistant-only blocks while folding system content into a user turn", () => {
    const body = {
      messages: [
        { role: "user", content: "ask" },
        { role: "system", content: [
          { type: "text", text: "instruction" },
          { type: "thinking", thinking: "secret", signature: "sig" },
          { type: "redacted_thinking", data: "secret" },
          { type: "tool_use", id: "u1", name: "read", input: {} },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
        ] },
        { role: "user", content: "answer" },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "answer" },
        { type: "text", text: "instruction" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
      ],
    });
  });

  it("never folds a system reminder into an assistant tool-use turn", () => {
    const toolUse = { type: "tool_use", id: "tu_1", name: "read", input: {} };
    const toolResult = { type: "tool_result", tool_use_id: "tu_1", content: "ok" };
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "read it" }] },
        { role: "system", content: [{ type: "text", text: "use concise output" }] },
        { role: "assistant", content: [toolUse] },
        { role: "user", content: [toolResult] },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "read it" }] },
      { role: "assistant", content: [toolUse] },
      {
        role: "user",
        content: [
          toolResult,
          { type: "text", text: "use concise output" },
        ],
      },
    ]);
  });

  it("drops a trailing system message when the conversation does not already end on a user turn", () => {
    // A bare system message at the end (no later user turn, last real turn is
    // assistant) is a client error. Folding it into a synthesized standalone
    // user turn would break role alternation. Drop it instead.
    const body = {
      messages: [
        { role: "user", content: "ask" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "system", content: "stray hint" },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { ...PRESERVE_ASSISTANT_PREFILL, foldSystemTurns: true });

    expect(body.messages).toEqual([
      { role: "user", content: "ask" },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("drops trailing system blocks even when the preceding retained turn is a user", () => {
    // Folding backward alters an already-complete user turn. With no later user
    // turn available, the complete system message must instead be discarded.
    const body = {
      messages: [
        { role: "user", content: "ask" },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "user", content: "followup" },
        { role: "system", content: "be brief" },
      ],
    };

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.messages).toEqual([
      { role: "user", content: "ask" },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      { role: "user", content: "followup" },
    ]);
  });
});
