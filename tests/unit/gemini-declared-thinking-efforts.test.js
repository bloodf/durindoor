import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("Gemini model-declared thinking levels", () => {
  it.each([
    ["none", "low"],
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "high"],
  ])("normalizes %s to the Gemini 3.8 accepted level %s", (effort, level) => {
    const body = { reasoning_effort: effort, contents: [{ role: "user", parts: [{ text: "Explain a red circle." }] }] };
    applyThinking("gemini", "gemini-3.8-flash", body, "gemini");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level, includeThoughts: true });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("retains minimal for models whose existing level contract permits it", () => {
    const body = { reasoning_effort: "none" };
    applyThinking("gemini", "gemini-3-flash-preview", body, "gemini");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal", includeThoughts: false });
  });
});
