import { expect, it } from "vitest";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

it("wraps bare tool parameter maps on both Gemini request paths", () => {
  const schema = { action: { type: "string" }, args: { type: "object" }, required: ["action"] };
  const claude = claudeToGeminiRequest("gemini-2.5-pro", { messages: [], tools: [{ name: "run", input_schema: schema }] }, false);
  const openai = openaiToGeminiRequest("gemini-2.5-pro", { messages: [], tools: [{ type: "function", function: { name: "run", parameters: schema } }] }, false);
  for (const output of [claude, openai]) {
    expect(output.tools[0].functionDeclarations[0].parameters).toMatchObject({ type: "object", properties: { action: { type: "string" }, args: { type: "object" } }, required: ["action"] });
  }
});
