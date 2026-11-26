import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

describe("null content parts", () => {
  it("preserves text through OpenAI to Kiro", () => {
    const result = openaiToKiroRequest("model", { messages: [{ role: "user", content: [null, { type: "text", text: "hello" }] }] }, true);
    expect(result.conversationState.currentMessage.userInputMessage.content).toContain("hello");
  });
  it("preserves text through OpenAI to Claude", () => {
    const result = openaiToClaudeRequest("model", { messages: [{ role: "user", content: [null, { type: "text", text: "hello" }] }] }, true);
    expect(result.messages[0].content).toContainEqual({ type: "text", text: "hello" });
  });
  it("recognizes a bypass with null parts", () => {
    expect(handleBypassRequest({ messages: [{ role: "user", content: [null, { type: "text", text: "Warmup" }] }] }, "model", "claude-cli")).not.toBeNull();
  });
});

describe("decolua/9router#629 - translateRequest drops null content parts for every target", () => {
  const targets = Object.values(FORMATS).filter((format) => format !== FORMATS.KIRO && format !== FORMATS.CURSOR);
  const openaiBody = () => ({
    model: "m",
    messages: [
      { role: "system", content: [null, { type: "text", text: "sys" }] },
      { role: "user", content: [null, { type: "text", text: "hello" }] },
      { role: "assistant", content: [null, { type: "text", text: "calling" }], tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: [null, { type: "text", text: "tool-out" }] },
      { role: "user", content: [null, { type: "text", text: "again" }] }
    ]
  });
  const claudeBody = () => ({
    model: "m",
    system: [null, { type: "text", text: "sys" }],
    messages: [
      { role: "user", content: [null, { type: "text", text: "hello" }] },
      { role: "assistant", content: [null, { type: "tool_use", id: "toolu_1", name: "f", input: {} }] },
      { role: "user", content: [null, { type: "tool_result", tool_use_id: "toolu_1", content: [null, { type: "text", text: "tool-out" }] }] }
    ]
  });

  it.each(targets)("OpenAI source to %s keeps text and tool results", (target) => {
    const json = JSON.stringify(translateRequest(FORMATS.OPENAI, target, "m", openaiBody(), false));
    expect(json).toContain("hello");
    expect(json).toContain("tool-out");
  });

  it.each(targets)("Claude source to %s keeps text and nested tool results", (target) => {
    const json = JSON.stringify(translateRequest(FORMATS.CLAUDE, target, "m", claudeBody(), false));
    expect(json).toContain("hello");
    expect(json).toContain("tool-out");
  });

  it("does not mutate the caller's content arrays", () => {
    const body = claudeBody();
    translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", body, false);
    expect(body.system[0]).toBeNull();
    expect(body.messages[0].content[0]).toBeNull();
    expect(body.messages[2].content[1].content[0]).toBeNull();
  });
});
