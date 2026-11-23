import { describe, expect, it } from "vitest";
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
