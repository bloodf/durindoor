import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const gemmaModels = ["gemma-4-31b-it", "gemma-4-26b-a4b-it"];
const translatedTargets = [
  [FORMATS.GEMINI, "gemini"],
  [FORMATS.VERTEX, "vertex"]
];

function translateOpenAI(target, provider, model) {
  return translateRequest(
    FORMATS.OPENAI,
    target,
    model,
    { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" },
    false,
    { apiKey: "test" },
    provider
  );
}

describe("OpenAI → Gemini Gemma 4 thinkingConfig guard", () => {
  it.each(gemmaModels.flatMap((model) => translatedTargets.map(([target, provider]) => [model, target, provider]))) (
    "omits thinkingConfig for %s on the %s path",
    (model, target, provider) => {
      expect(translateOpenAI(target, provider, model).generationConfig.thinkingConfig).toBeUndefined();
    }
  );

  it("keeps thinkingConfig for non-Gemma models", () => {
    expect(translateOpenAI(FORMATS.VERTEX, "vertex", "gemini-2.5-flash").generationConfig.thinkingConfig)
      .toEqual({ thinkingBudget: 24576, includeThoughts: true });
  });

  it.each([
    [FORMATS.GEMINI, { generationConfig: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } }],
    [FORMATS.GEMINI_CLI, { request: { generationConfig: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } } }],
    [FORMATS.ANTIGRAVITY, { request: { generationConfig: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } } }]
  ])("preserves explicit thinkingConfig on native %s bodies", (format, body) => {
    const out = translateRequest(format, format, "gemma-4-31b-it", structuredClone(body), false, null, format);
    expect(out.request?.generationConfig?.thinkingConfig ?? out.generationConfig?.thinkingConfig)
      .toEqual({ thinkingLevel: "high", includeThoughts: true });
  });
});
