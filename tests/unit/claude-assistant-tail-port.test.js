import { describe, expect, it } from "vitest";
import { normalizeClaudeAssistantTail } from "../../open-sse/translator/concerns/claudeAssistantTail.js";

describe("Claude assistant tail normalization", () => {
  it("trims only final assistant text and preserves the input object", () => {
    const input = { messages: [
      { role: "user", content: "keep  " },
      { role: "assistant", content: [{ type: "text", text: "answer  \n" }] },
    ] };
    const output = normalizeClaudeAssistantTail(input);
    expect(output.messages.at(-1).content[0].text).toBe("answer");
    expect(input.messages.at(-1).content[0].text).toBe("answer  \n");
    expect(output.messages[0]).toBe(input.messages[0]);
  });

  it("does not trim past a non-text boundary", () => {
    const tool = { type: "tool_use", id: "toolu_1", name: "run", input: {} };
    const input = { messages: [{ role: "assistant", content: [
      { type: "text", text: "keep  " }, tool, { type: "text", text: "  " },
    ] }] };
    const output = normalizeClaudeAssistantTail(input);
    expect(output.messages[0].content).toEqual([{ type: "text", text: "keep  " }, tool]);
  });
});
