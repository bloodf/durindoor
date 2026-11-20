import { describe, expect, it } from "vitest";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";
import { convertGeminiToInternal } from "../../src/app/api/v1beta/models/[...path]/geminiBridge.js";

describe("Gemini function declarations with parametersJsonSchema", () => {
  const schema = { type: "object", properties: { query: { type: "string" } } };
  const request = { contents: [{ role: "user", parts: [{ text: "search" }] }], tools: [{ functionDeclarations: [{ name: "search", parametersJsonSchema: schema }] }] };
  it("preserves schemas through Gemini, Antigravity, and the v1beta bridge", () => {
    for (const result of [geminiToOpenAIRequest("m", request, false), antigravityToOpenAIRequest("m", { request }, false), convertGeminiToInternal(request, "m", false)]) {
      expect(result.tools[0].function.parameters).toEqual(schema);
    }
  });
  it("prefers parameters when both schema fields exist", () => {
    const body = { ...request, tools: [{ functionDeclarations: [{ name: "search", parameters: { type: "object" }, parametersJsonSchema: schema }] }] };
    expect(convertGeminiToInternal(body, "m", false).tools[0].function.parameters).toEqual({ type: "object" });
  });
});
