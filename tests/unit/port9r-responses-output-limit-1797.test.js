import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("Responses output limits", () => {
  it.each([
    { messages: [{ role: "user", content: "hello" }] },
    { input: "hello" },
  ])("maps the Chat completion limit for either request shape", (input) => {
    const result = openaiToOpenAIResponsesRequest("model", { ...input, max_completion_tokens: 42, max_tokens: 9 }, false);
    expect(result.max_output_tokens).toBe(42);
    expect(result).not.toHaveProperty("max_completion_tokens");
    expect(result).not.toHaveProperty("max_tokens");
  });

  it("preserves an explicit Responses limit", () => {
    const result = openaiToOpenAIResponsesRequest("model", { input: "hello", max_output_tokens: 17, max_completion_tokens: 42 }, false);
    expect(result.max_output_tokens).toBe(17);
    expect(result).not.toHaveProperty("max_completion_tokens");
  });
});
