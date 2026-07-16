import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../open-sse/config/defaultThinkingSignature.js";

describe("native Fable/Mythos thinking sanitation", () => {
  it("drops synthetic DEFAULT_THINKING_CLAUDE_SIGNATURE placeholders from Fable assistant history", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-fable-5",
      thinking: { type: "adaptive", display: "summarized" },
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: ".", signature: DEFAULT_THINKING_CLAUDE_SIGNATURE },
            { type: "text", text: "hi" },
          ],
        },
      ],
    }, "claude-fable-5", "claude");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content.some((b) => b.type === "thinking")).toBe(false);
  });

  it("drops invalid/synthetic/unsigned thinking blocks from Mythos assistant history", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-mythos-5",
      thinking: { type: "adaptive", display: "summarized" },
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan" },
            { type: "thinking", thinking: "synthetic", signature: "fake" },
            { type: "text", text: "hi" },
          ],
        },
      ],
    }, "claude-mythos-5", "claude");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content.some((b) => b.type === "thinking")).toBe(false);
  });

  it("prepareClaudeRequest never synthesizes placeholder for Fable even with enabled thinking and tool_use", () => {
    const out = prepareClaudeRequest({
      model: "claude-fable-5",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "x" } }] },
        { role: "user", content: "result" },
      ],
    }, "claude");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content.some((b) => b.type === "thinking")).toBe(false);
  });

  it("preserves valid signed thinking blocks for Fable", () => {
    const validSignature = Buffer.from([0x12, 0x00, 0x00]).toString("base64");
    const out = normalizeClaudePassthrough({
      model: "claude-fable-5",
      thinking: { type: "adaptive", display: "summarized" },
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "genuine", signature: validSignature },
            { type: "text", text: "hi" },
          ],
        },
      ],
    }, "claude-fable-5", "claude");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual(expect.objectContaining({ type: "thinking", thinking: "genuine", signature: validSignature }));
  });
});

describe("Opus/Sonnet thinking placeholder behavior preserved", () => {
  it("preserves valid signed thinking blocks for Sonnet 4.5", () => {
    const validSignature = Buffer.from([0x12, 0x00, 0x00]).toString("base64");
    const out = normalizeClaudePassthrough({
      model: "claude-sonnet-4-5",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "my reasoning", signature: validSignature },
            { type: "text", text: "hi" },
          ],
        },
      ],
    }, "claude-sonnet-4-5", "claude");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual(expect.objectContaining({ type: "thinking", thinking: "my reasoning" }));
  });

  it("adds DEFAULT_THINKING_CLAUDE_SIGNATURE placeholder for Sonnet 4.5 tool_use when enabled thinking is on and none exists", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4-5",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "x" } }] },
        { role: "user", content: "result" },
      ],
    }, "claude");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: ".", signature: DEFAULT_THINKING_CLAUDE_SIGNATURE });
  });
});
