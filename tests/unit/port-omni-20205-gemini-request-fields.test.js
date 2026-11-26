import { describe, it, expect } from "vitest";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";
import { antigravityToOpenAIRequest } from "../../open-sse/translator/request/antigravity-to-openai.js";

const request = {
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  generationConfig: { stopSequences: ["a", "b", "c", "d", "e"] },
  tools: [{ functionDeclarations: [{ name: "run", parameters: { type: "object", properties: {} } }] }],
  toolConfig: { functionCallingConfig: { mode: "NONE" } }
};

describe("OmniRoute #20205: Gemini request fields survive translation to OpenAI", () => {
  it.each([
    ["Gemini", () => geminiToOpenAIRequest("m", request, false)],
    ["Antigravity", () => antigravityToOpenAIRequest("m", { request }, false)]
  ])("%s keeps stop sequences (at most four) and the tool choice", (_name, translate) => {
    const result = translate();
    expect(result.stop).toEqual(["a", "b", "c", "d"]);
    expect(result.tool_choice).toBe("none");
  });

  it("keeps an Antigravity fileData part", () => {
    const result = antigravityToOpenAIRequest("m", { request: { contents: [{ role: "user", parts: [{ fileData: { fileUri: "https://example.test/a.png", mimeType: "image/png" } }] }] } }, false);
    expect(JSON.stringify(result.messages)).toContain("https://example.test/a.png");
  });
});
