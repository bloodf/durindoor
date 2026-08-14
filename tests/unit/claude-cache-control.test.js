import { describe, expect, it } from "vitest";
import { anchorClaudeCache, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

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

    normalizeClaudePassthrough(body);

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

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

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

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

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

  it("preserves non-text blocks (images) when folding, folding only the textual portion", () => {
    // Some clients may include image blocks in a "system" role message.
    // The fold must NOT drop them; non-text blocks stay in place as a
    // (now emptied-of-text) system message, and only the text folds forward.
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

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.messages).toHaveLength(4);
    expect(body.messages[1]).toEqual({
      role: "system",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } }],
    });
    expect(body.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what do you see?" },
        { type: "text", text: "hint: focus on color" },
      ],
    });
    expect(body.messages[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "red" }] });
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

    normalizeClaudePassthrough(body, "", "claude", null, { foldSystemTurns: true });

    expect(body.messages).toEqual([
      { role: "user", content: "ask" },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
    ]);
  });

  it("appends a trailing system message to the last turn when it is already a user turn", () => {
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
      {
        role: "user",
        content: [
          { type: "text", text: "followup" },
          { type: "text", text: "be brief" },
        ],
      },
    ]);
  });
});
