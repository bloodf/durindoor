import { describe, expect, it } from "vitest";
import { applyThinking, captureThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// stepfun renders the "step" format; a compatible gateway renders the "openai"
// lane (#2800). Both must keep the effort the client asked for.
const TARGETS = [
  ["stepfun", "step-3.7-flash"],
  ["openai-compatible-step", "step-5-preview-free"],
];

const apply = (provider, model, body, intent) => {
  applyThinking(FORMATS.OPENAI, model, body, provider, intent);
  return body;
};

describe.each(TARGETS)("Step explicit reasoning effort on %s (decolua/9router#5064)", (provider, model) => {
  it.each(["low", "medium", "high", "xhigh", "max"])("preserves explicit reasoning_effort %s", (level) => {
    expect(apply(provider, model, { reasoning_effort: level }).reasoning_effort).toBe(level);
  });

  it.each(["max", "xhigh"])("preserves a %s model suffix over a conflicting body effort", (level) => {
    expect(apply(provider, `${model}(${level})`, { reasoning_effort: "low" }).reasoning_effort).toBe(level);
  });

  it.each(["max", "xhigh"])("preserves captured Responses effort %s after translation", (level) => {
    const intent = captureThinking({ reasoning: { effort: level } });
    expect(apply(provider, model, {}, intent).reasoning_effort).toBe(level);
  });

  it.each([32768, 128000])("still converts a %i token budget to high", (budget) => {
    const body = { thinking: { type: "enabled", budget_tokens: budget } };
    expect(apply(provider, model, body).reasoning_effort).toBe("high");
  });

  it("leaves a request without thinking intent alone", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    expect(apply(provider, model, structuredClone(body))).toEqual(body);
  });
});
