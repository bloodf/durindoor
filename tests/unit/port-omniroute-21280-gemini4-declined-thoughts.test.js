import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const thinkingConfig = (source, provider, model, extra) => {
  const body = { model, messages: [{ role: "user", content: "ping" }], max_tokens: 65536, ...extra };
  return translateRequest(source, "gemini", model, body, false, null, provider).generationConfig.thinkingConfig;
};

describe("OmniRoute #21280 (a1f307f0d2f2) Gemini 4 keeps a client's thinking opt-out", () => {
  const optOuts = [
    ["openai", { reasoning_effort: "none" }],
    ["claude", { thinking: { type: "disabled" } }],
  ];

  it("floors the level to low and hides thoughts", () => {
    for (const [provider, model] of [["gemini", "gemini-4-hydrogen"], ["gemini", "gemini-4-argon"], ["vertex", "gemini-4-carbon"]]) {
      for (const [source, extra] of optOuts) {
        expect(thinkingConfig(source, provider, model, extra), `${provider}/${model} ${source}`)
          .toEqual({ thinkingLevel: "low", includeThoughts: false });
      }
    }
  });

  it("still shows thoughts when the client asks for minimal or a real level", () => {
    expect(thinkingConfig("openai", "gemini", "gemini-4-hydrogen", { reasoning_effort: "minimal" }))
      .toEqual({ thinkingLevel: "low", includeThoughts: true });
    expect(thinkingConfig("openai", "gemini", "gemini-4-hydrogen", { reasoning_effort: "high" }))
      .toEqual({ thinkingLevel: "high", includeThoughts: true });
  });
});
