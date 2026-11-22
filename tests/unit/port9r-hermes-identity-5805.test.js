import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_HERMES_IDENTITY_REWRITE as rule } from "../../open-sse/config/appConstants.js";

describe("Antigravity Hermes identity rewrite", () => {
  it.each(["You are Hermes Agent.", "Hermes Agent — a helpful AI assistant made by Nous Research."])("rewrites %s", (input) => {
    expect(input.replace(rule.from, rule.to)).toBe("You are an AI assistant.");
  });
  it("preserves ordinary project references", () => {
    const input = "Project Hermes Agent migration is scheduled.";
    expect(input.replace(rule.from, rule.to)).toBe(input);
  });
});
