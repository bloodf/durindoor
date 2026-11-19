import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";

describe("Antigravity OpenClaw identity rewrite", () => {
  it("replaces the complete identity sentence case-insensitively", () => {
    const sentence = "You are a personal assistant running inside OpenClaw.";
    expect(sentence.replace(ANTIGRAVITY_PROMPT_REWRITES.at(-2).from, ANTIGRAVITY_PROMPT_REWRITES.at(-2).to))
      .toBe("You are a personal assistant.");
  });
});
