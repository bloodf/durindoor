// decolua/9router #4982: role "developer" is a system instruction. DurinDoor's Claude
// translator already handled it; the Gemini/Antigravity request translators dropped it.
import { describe, it, expect } from "vitest";
import { openaiToGeminiRequest, openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const messages = (role) => [
  { role, content: "Return JSON only." },
  { role: "user", content: "Page: Example Domain" },
];

describe("developer role is a system instruction", () => {
  it.each(["system", "developer"])("Gemini: role %s -> systemInstruction", (role) => {
    const out = openaiToGeminiRequest("gemini-3-flash", { messages: messages(role) }, false);
    expect(out.systemInstruction.parts[0].text).toBe("Return JSON only.");
    expect(out.contents).toHaveLength(1);
    expect(out.contents[0].parts[0].text).toBe("Page: Example Domain");
  });

  it("Antigravity: developer -> systemInstruction, not a turn", () => {
    const out = openaiToAntigravityRequest("gemini-3-flash", { messages: messages("developer") }, false);
    const req = out.request || out;
    expect(JSON.stringify(req.systemInstruction)).toContain("Return JSON only.");
    expect(req.contents).toHaveLength(1);
  });

  it.each(["system", "developer"])("Claude: role %s -> system block, not a turn", (role) => {
    const out = openaiToClaudeRequest("claude-haiku-4-5", { messages: messages(role) }, false);
    expect(JSON.stringify(out.system)).toContain("Return JSON only.");
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
  });
});
