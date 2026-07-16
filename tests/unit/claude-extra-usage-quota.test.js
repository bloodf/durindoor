import { describe, expect, it } from "vitest";

import {
  getRemainingPercentage,
  parseQuotaData,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

// Port of OmniRoute #6896 (#6806): Claude Code plans such as
// "default_raven_enterprise" return an empty `quotas: {}` (no five_hour /
// seven_day utilization windows from Anthropic) but a fully populated,
// possibly 100%-exhausted `extraUsage` credit block. The dashboard must fold
// extraUsage into a credits-style quota row instead of rendering
// "No quota data".
describe("claude extraUsage credits quota", () => {
  it("surfaces extraUsage credits when quotas object is empty", () => {
    const parsed = parseQuotaData("claude", {
      plan: "default_raven_enterprise",
      quotas: {},
      extraUsage: {
        is_enabled: true,
        monthly_limit: 120000,
        used_credits: 120015,
        utilization: 100,
        currency: "USD",
        decimal_places: 2,
        disabled_reason: null,
        daily: null,
        weekly: null,
      },
    });

    expect(parsed.length).toBeGreaterThan(0);
    const creditRow = parsed.find((row) => row.isCredits);
    expect(creditRow).toBeDefined();
    expect(creditRow.name).toBe("extra_usage");
    expect(creditRow.remainingPercentage).toBe(0); // utilization 100% → 0% remaining
    expect(creditRow.creditCount).toBe(0); // 120000 - 120015 clamped to 0
    expect(creditRow.currency).toBe("USD");
    // displayed percentage must come from remainingPercentage, not the
    // absolute credit balance in `remaining`
    expect(getRemainingPercentage(creditRow)).toBe(0);
  });

  it("still surfaces extraUsage credits when quotas is also populated", () => {
    const parsed = parseQuotaData("claude", {
      plan: "pro",
      quotas: {
        "session (5h)": { used: 10, total: 100, remainingPercentage: 90, resetAt: null },
      },
      extraUsage: {
        is_enabled: true,
        monthly_limit: 5000,
        used_credits: 1000,
        utilization: 20,
        currency: "USD",
        decimal_places: 2,
        disabled_reason: null,
        daily: null,
        weekly: null,
      },
    });

    expect(parsed).toHaveLength(2);
    const creditRow = parsed.find((row) => row.isCredits);
    expect(creditRow).toBeDefined();
    expect(creditRow.remainingPercentage).toBe(80); // utilization 20% → 80% remaining
    expect(creditRow.creditCount).toBe(4000); // absolute balance preserved
    expect(getRemainingPercentage(creditRow)).toBe(80);
  });

  it("does not add a credits row when extraUsage is disabled or missing", () => {
    for (const extraUsage of [
      { is_enabled: false, monthly_limit: 5000, used_credits: 0, utilization: 0 },
      undefined,
    ]) {
      const parsed = parseQuotaData("claude", {
        plan: "pro",
        quotas: {
          "session (5h)": { used: 10, total: 100, remainingPercentage: 90, resetAt: null },
        },
        extraUsage,
      });

      expect(parsed).toHaveLength(1);
      expect(parsed.some((row) => row.isCredits)).toBe(false);
    }
  });

  it("never renders an absolute legacy `remaining` count as a percentage", () => {
    // Codex P2 on PR #278: admin/legacy payloads carry an absolute request
    // count in `remaining`. Forwarding it makes getRemainingPercentage prefer
    // it over the derived percentage → 4,000% instead of 80%.
    const parsed = parseQuotaData("claude", {
      plan: "pro",
      quotas: {
        "legacy requests": { used: 1000, total: 5000, remaining: 4000, resetAt: null },
        "oauth window": { used: 10, total: 100, remaining: 90, remainingPercentage: 88, resetAt: null },
      },
    });

    expect(parsed).toHaveLength(2);
    // absolute count ignored → derived from used/total
    expect(getRemainingPercentage(parsed.find((r) => r.name === "legacy requests"))).toBe(80);
    // explicit remainingPercentage wins, not the absolute `remaining`
    expect(getRemainingPercentage(parsed.find((r) => r.name === "oauth window"))).toBe(88);
  });
});
