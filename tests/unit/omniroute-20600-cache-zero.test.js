import { describe, expect, it } from "vitest";
import { openAIResponsesBodyToOpenAI } from "../../open-sse/translator/response/openai-responses-nonstream.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

describe("Responses cache usage", () => {
  it.each([0, 4, undefined])("preserves reported cache count %s in both response paths", (cached) => {
    const usage = { input_tokens: 10, output_tokens: 2, ...(cached === undefined ? {} : { input_tokens_details: { cached_tokens: cached } }) };
    const response = { id: "resp_test", model: "test", output: [], usage };
    const nonstream = openAIResponsesBodyToOpenAI(response);
    const state = {};
    openaiResponsesToOpenAIResponse({ type: "response.completed", response }, state);
    for (const result of [nonstream.usage, state.usage]) {
      expect(result.prompt_tokens_details?.cached_tokens).toBe(cached);
    }
  });
});
