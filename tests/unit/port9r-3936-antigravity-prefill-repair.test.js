import { describe, expect, it } from "vitest";
import { openaiToClaudeRequestForAntigravity } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { applyAssistantPrefillPolicy } from "../../open-sse/translator/concerns/assistantPrefillPolicy.js";

const translate = (messages) => openaiToClaudeRequestForAntigravity("claude-opus-4-6", { messages }, false);

describe("9router #3936 - Antigravity Claude repairs a trailing assistant prefill", () => {
  it("keeps partial assistant text and ends on a continuation turn", () => {
    const { messages } = translate([
      { role: "user", content: "Start" },
      { role: "assistant", content: "Partial answer" },
    ]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(messages[1])).toContain("Partial answer");
    expect(JSON.stringify(messages[2])).toMatch(/without repeating/);
  });

  it("keeps a trailing tool call paired in the Cloud Code envelope", () => {
    const { request } = openaiToAntigravityRequest("claude-opus-4-6", { messages: [
      { role: "user", content: "Look it up" },
      { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
    ] }, true, {});
    const parts = request.contents.flatMap((content) => content.parts);
    const call = parts.find((part) => part.functionCall).functionCall;
    expect(parts.find((part) => part.functionResponse).functionResponse.id).toBe(call.id);
    expect(request.contents.at(-1).role).toBe("user");
  });

  it("rechecks the tail after dropping an empty assistant turn", () => {
    const body = { messages: [
      { role: "user", content: "Start" },
      { role: "assistant", content: [{ type: "text", text: "Partial" }] },
      { role: "assistant", content: [] },
      { role: "assistant", content: "  " },
    ] };
    expect(applyAssistantPrefillPolicy(body).messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  });
});
