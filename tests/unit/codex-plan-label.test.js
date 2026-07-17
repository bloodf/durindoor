// Covers the shared Codex plan badge-visibility rule used by both the provider
// connection row (ConnectionRow.js) and the usage quota view (ProviderLimits).
// Both delegate to getCodexPlanLabel so their suppression logic cannot drift.
import { describe, expect, it } from "vitest";
import { getCodexPlanLabel } from "@/shared/utils/codexPlanLabel";

describe("getCodexPlanLabel", () => {
  it("returns the trimmed plan for a Codex connection", () => {
    expect(getCodexPlanLabel(true, "  Pro  ")).toBe("Pro");
    expect(getCodexPlanLabel(true, "Team")).toBe("Team");
  });

  it("hides the badge for non-Codex providers regardless of value", () => {
    expect(getCodexPlanLabel(false, "Pro")).toBe("");
  });

  it("hides the badge for empty or whitespace-only plans", () => {
    expect(getCodexPlanLabel(true, "")).toBe("");
    expect(getCodexPlanLabel(true, "   ")).toBe("");
  });

  it("hides the badge for the 'unknown' placeholder, case-insensitively", () => {
    expect(getCodexPlanLabel(true, "unknown")).toBe("");
    expect(getCodexPlanLabel(true, "UNKNOWN")).toBe("");
    expect(getCodexPlanLabel(true, "  Unknown ")).toBe("");
  });

  it("hides the badge for non-string values", () => {
    expect(getCodexPlanLabel(true, undefined)).toBe("");
    expect(getCodexPlanLabel(true, null)).toBe("");
    expect(getCodexPlanLabel(true, 42)).toBe("");
  });
});
