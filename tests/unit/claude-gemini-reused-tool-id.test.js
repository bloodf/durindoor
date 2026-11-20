import { expect, it } from "vitest";
import { claudeToGeminiRequest } from "../../open-sse/translator/request/claude-to-gemini.js";

it("pairs reused tool IDs with their own historical tool names", () => {
  const messages = ["edit", "bash"].flatMap((name) => [
    { role: "assistant", content: [{ type: "tool_use", id: "same", name, input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "same", content: name }] },
  ]);
  const result = claudeToGeminiRequest("gemini-2.5-pro", { messages }, false);
  const texts = result.contents.flatMap((entry) => entry.parts).map((part) => part.text).filter(Boolean);
  expect(texts).toEqual(["[Historical tool result for edit]: edit", "[Historical tool result for bash]: bash"]);
});
