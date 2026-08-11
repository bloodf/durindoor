// Visibility rules for the shared Codex plan label helper: which raw values are
// renderable at all. The live-first/stored-fallback precedence that
// decolua/9router#3210 introduced is a separate concern, covered by
// codex-plan-live-fallback.test.js — this file only pins the value filter both
// views build on.
import { describe, expect, it } from "vitest";
import { getCodexPlanLabel } from "../../src/shared/utils/codexPlanLabel.js";

describe("Codex plan badge label", () => {
  it("shows a real plan for a Codex row", () => {
    expect(getCodexPlanLabel(true, "Plus")).toBe("Plus");
    expect(getCodexPlanLabel(true, "Team")).toBe("Team");
    expect(getCodexPlanLabel(true, "Pro")).toBe("Pro");
  });

  it("trims surrounding whitespace", () => {
    expect(getCodexPlanLabel(true, "  Pro  ")).toBe("Pro");
  });

  // The API returns the literal string "unknown" when it cannot determine a
  // plan; rendering that as a badge would be worse than rendering nothing.
  it("hides the placeholder plan regardless of case", () => {
    for (const raw of ["unknown", "Unknown", "UNKNOWN"]) {
      expect(getCodexPlanLabel(true, raw), raw).toBe("");
    }
  });

  it("hides empty and whitespace-only plans", () => {
    expect(getCodexPlanLabel(true, "")).toBe("");
    expect(getCodexPlanLabel(true, "   ")).toBe("");
  });

  it("hides the badge for non-Codex rows", () => {
    expect(getCodexPlanLabel(false, "Plus")).toBe("");
  });

  it("hides the badge for non-string values", () => {
    for (const raw of [null, undefined, 42, {}, []]) {
      expect(getCodexPlanLabel(true, raw), String(raw)).toBe("");
    }
  });
});
