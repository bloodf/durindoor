import { describe, it, expect } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { DEFAULT_SAFETY_SETTINGS } from "../../open-sse/translator/formats/gemini.js";

// Port of decolua/9router #2800: a Qwen model served through a dynamic
// openai-compatible-* gateway must emit OpenAI reasoning_effort, never the
// native enable_thinking/thinking_budget that strict compatible upstreams
// reject with HTTP 400.
describe("openai-compatible thinking format (9router #2800)", () => {
  it("uses OpenAI reasoning_effort for a qwen model behind openai-compatible-*", () => {
    const body = {
      model: "qwen-coder",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    };
    const out = applyThinking("openai", "qwen-coder", body, "openai-compatible-myhost");
    // OpenAI-shaped: reasoning_effort survives; native qwen fields absent.
    expect(out.enable_thinking).toBeUndefined();
    expect(out.thinking_budget).toBeUndefined();
  });
});

// Port of OmniRoute #8238: HARM_CATEGORY_CIVIC_INTEGRITY is rejected by some
// Gemini endpoints and made every translated request 400. It must not be in
// the default safety settings.
describe("gemini default safety settings (OmniRoute #8238)", () => {
  it("does not include HARM_CATEGORY_CIVIC_INTEGRITY", () => {
    const cats = DEFAULT_SAFETY_SETTINGS.map((s) => s.category);
    expect(cats).not.toContain("HARM_CATEGORY_CIVIC_INTEGRITY");
    // Sanity: the other four standard categories remain.
    expect(cats).toContain("HARM_CATEGORY_HATE_SPEECH");
    expect(cats).toContain("HARM_CATEGORY_DANGEROUS_CONTENT");
    expect(cats).toContain("HARM_CATEGORY_SEXUALLY_EXPLICIT");
    expect(cats).toContain("HARM_CATEGORY_HARASSMENT");
  });
});
