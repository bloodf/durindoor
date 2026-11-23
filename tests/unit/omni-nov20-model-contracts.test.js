import { describe, expect, it } from "vitest";
import { getThinkingLevels, getThinkingLevelsFromCapabilities } from "../../open-sse/providers/thinkingLevels.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

describe("November OmniRoute existing model contracts", () => {
  it("scopes Flash efforts to OpenCode Go and its provider alias", () => {
    for (const provider of ["opencode-go", "ocg"]) {
      for (const model of ["deepseek-v4.1-flash", "deepseek-flash"]) {
        expect(getThinkingLevels(provider, model)).toEqual(["low", "high", "max"]);
      }
    }
    expect(getThinkingLevels("deepseek", "deepseek-v4.1-flash")).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  });

  it("preserves explicitly declared Antigravity efforts and Hydrogen alias", () => {
    expect(getThinkingLevelsFromCapabilities({ reasoning: true, thinkingEfforts: ["high"] }, "antigravity", "gemini-3.8-flash-high")).toEqual(["high"]);
    // Upstream 9router 767d7aeb0b defaults the Hydrogen alias to its high tier.
    expect(getModelUpstreamId("antigravity", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high");
  });
});
