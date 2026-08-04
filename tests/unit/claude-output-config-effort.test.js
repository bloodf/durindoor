import { describe, expect, it } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("Claude output_config effort", () => {
  it("passes max through as OpenAI reasoning_effort", () => {
    const result = claudeToOpenAIRequest("gpt-5", {
      messages: [{ role: "user", content: "hi" }],
      output_config: { effort: "max" },
    }, false);

    expect(result.reasoning_effort).toBe("max");
  });
});