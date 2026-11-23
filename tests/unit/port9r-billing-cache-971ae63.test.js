import { expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

it("removes billing metadata from each Claude system block", () => {
  const body = { messages: [{ role: "system", content: [{ type: "text", text: "stable" }, { type: "text", text: "x-anthropic-billing-header: variable\ninstructions" }] }, { role: "user", content: "hello" }] };
  const result = openaiToClaudeRequest("claude-opus-4-8", body, false, null, { provider: "claude" });
  expect(JSON.stringify(result.system)).toContain("stable\\ninstructions");
  expect(JSON.stringify(result.system)).not.toContain("x-anthropic-billing-header");
});
