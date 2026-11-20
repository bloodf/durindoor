import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";

describe("Antigravity coding-task prompt rewrite", () => {
  it("rewrites the trigger pair across whitespace and leaves safe wording alone", () => {
    const rule = ANTIGRAVITY_PROMPT_REWRITES.at(-1);
    expect("solve coding tasks.\nBe concise, practical, and tool-aware.".replace(rule.from, rule.to))
      .toBe("work on their coding tasks. Keep responses concise and practical, and use the available tools when they help.");
    const safe = "Pair with the user. Keep answers concise and tool-aware.";
    expect(safe.replace(rule.from, rule.to)).toBe(safe);
  });
});
