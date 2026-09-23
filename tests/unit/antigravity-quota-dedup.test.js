// Port of upstream be3bc764 (dashboard half): when retrieveUserQuotaSummary reports a
// family-level 5h "session" row, it is authoritative for the same sliding window the
// per-model synthesized row (worst-case across gemini-*/claude-* models) approximates.
// Showing both is a redundant duplicate — the session row should win.
import { describe, expect, it } from "vitest";

import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Antigravity dashboard dedup against 5h session summary", () => {
  it("suppresses the synthesized Gemini row when gemini_session is present", () => {
    const quotas = parseQuotaData("antigravity", {
      quotas: {
        "gemini-3.8-flash-high": { used: 900, total: 1000, remainingPercentage: 10, resetAt: "2026-09-23T06:00:00Z" },
        gemini_session: { displayName: "Gemini 5h", used: 100, total: 1000, remainingPercentage: 90, resetAt: "2026-09-23T06:00:00Z" },
        gemini_weekly: { displayName: "Gemini Weekly", used: 250, total: 1000, remainingPercentage: 75, resetAt: "2026-09-29T00:00:00Z" },
      },
    });
    const names = quotas.map((q) => q.name);
    expect(names).not.toContain("Gemini (Flash / Pro)");
    expect(names).toContain("Gemini 5h");
    expect(names).toContain("Gemini Weekly");
  });

  it("suppresses the synthesized Claude row when claude_gpt_session is present", () => {
    const quotas = parseQuotaData("antigravity", {
      quotas: {
        "claude-sonnet-4-6": { used: 500, total: 1000, remainingPercentage: 50, resetAt: "2026-09-23T06:00:00Z" },
        claude_gpt_session: { displayName: "Claude & GPT 5h", used: 500, total: 1000, remainingPercentage: 50, resetAt: "2026-09-23T06:00:00Z" },
      },
    });
    const names = quotas.map((q) => q.name);
    expect(names).not.toContain("Claude (Sonnet / Opus)");
    expect(names).toContain("Claude & GPT 5h");
  });

  it("keeps the synthesized row when no session summary is present (backward compat)", () => {
    const quotas = parseQuotaData("antigravity", {
      quotas: {
        "gemini-3.8-flash-high": { used: 900, total: 1000, remainingPercentage: 10, resetAt: "2026-09-23T06:00:00Z" },
      },
    });
    expect(quotas.map((q) => q.name)).toContain("Gemini (Flash / Pro)");
  });
});
