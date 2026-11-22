import { expect, it } from "vitest";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

it("ends mixed parallel tool results with function responses", () => {
  const result = openaiToGeminiRequest("gemini-2.5-flash", { messages: [
    { role: "user", content: "look" },
    { role: "assistant", tool_calls: [
      { id: "one", type: "function", function: { name: "first", arguments: "{}" } },
      { id: "two", type: "function", function: { name: "second", arguments: "{}" } },
    ] },
    { role: "tool", tool_call_id: "one", content: "first result" },
    { role: "tool", tool_call_id: "two", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } }] },
  ] }, false);
  const parts = result.contents.at(-1).parts;
  expect(parts.map((p) => p.inlineData ? "image" : p.functionResponse?.name)).toEqual(["image", "first", "second"]);
});
