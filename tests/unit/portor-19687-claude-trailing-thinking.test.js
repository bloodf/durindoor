import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "claude-sonnet-4-5";
// Shaped like a real Anthropic signature so the signature filters keep the block.
const SIGNATURE = Buffer.from(`\x12\x40claude${"x".repeat(80)}`).toString("base64");
const thinking = (text) => ({ type: "thinking", thinking: text, signature: SIGNATURE });
const redacted = () => ({ type: "redacted_thinking", data: "SYNTHETIC_OPAQUE" });
const text = (value) => ({ type: "text", text: value });

const history = () => [
  { role: "user", content: [text("hi")] },
  { role: "assistant", content: [text("A"), thinking("t")] },
  { role: "user", content: [text("next")] },
  { role: "assistant", content: [redacted()] },
  { role: "user", content: [text("more")] },
  { role: "assistant", content: [text("latest"), thinking("keep")] },
  { role: "user", content: [text("again")] },
];

const types = (message) => message.content.map((block) => block.type);

function expectRepaired(messages) {
  const assistants = messages.filter((message) => message.role === "assistant");
  expect(assistants).toHaveLength(2);
  expect(types(assistants[0])).toEqual(["text"]);
  expect(types(assistants[1])).toEqual(["text", "thinking"]);
  expect(assistants[1].content[1]).toEqual(thinking("keep"));
  expect(messages.map((message) => message.role))
    .toEqual(["user", "assistant", "user", "assistant", "user"]);
}

describe("OmniRoute #19687 trailing thinking on past Claude assistant turns", () => {
  it.each([
    ["OpenAI to Claude", FORMATS.OPENAI],
    ["Claude to Claude", FORMATS.CLAUDE],
  ])("trims past turns and drops emptied ones (%s)", (_name, source) => {
    const out = translateRequest(source, FORMATS.CLAUDE, MODEL,
      { model: MODEL, max_tokens: 100, messages: history() }, false, null, "claude");
    expectRepaired(out.messages);
  });

  it("repairs a Claude Code passthrough body without touching the input", () => {
    const input = history();
    const out = normalizeClaudePassthrough(
      { model: MODEL, max_tokens: 100, messages: structuredClone(input) }, MODEL, "claude");
    expectRepaired(out.messages);
    expect(out.messages[3].content).toEqual(input[5].content);
  });

  it("keeps thinking that precedes a tool_use", () => {
    const out = normalizeClaudePassthrough({
      model: MODEL,
      max_tokens: 100,
      messages: [
        { role: "user", content: [text("hi")] },
        { role: "assistant", content: [thinking("t"), { type: "tool_use", id: "toolu_1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
        { role: "assistant", content: [text("done")] },
        { role: "user", content: [text("more")] },
      ],
    }, MODEL, "claude");
    expect(types(out.messages[1])).toEqual(["thinking", "tool_use"]);
  });

  it("leaves other Claude-wire hosts unchanged", () => {
    const messages = history();
    messages[1].content[1] = { type: "thinking", thinking: "t", signature: "host-signature" };
    const out = normalizeClaudePassthrough(
      { model: "kimi-k2", max_tokens: 100, messages }, "kimi-k2", "kimi");
    expect(types(out.messages[1])).toEqual(["text", "thinking"]);
  });
});
