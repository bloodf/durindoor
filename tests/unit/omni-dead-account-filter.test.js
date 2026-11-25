import { describe, expect, it } from "vitest";
import { filterAvailableAccounts } from "../../open-sse/services/accountFallback.js";

describe("filterAvailableAccounts", () => {
  it.each(["banned", "expired", "credits_exhausted", "deactivated", " BANNED "])(
    "rejects terminal status %s",
    (status) => {
      expect(filterAvailableAccounts([{ id: "account", status }])).toEqual([]);
    }
  );

  it.each([undefined, null, "active", "error", "rate_limited", "unknown"])(
    "retains a nonterminal status %s without an active lock",
    (status) => {
      const account = { id: "account", status };
      expect(filterAvailableAccounts([account])).toEqual([account]);
    }
  );

  it("preserves exclusion, quota lockout and cooldown behavior", () => {
    const accounts = [
      { id: "excluded" },
      { id: "locked", quotaLockout: { status: "quota_exhausted", reactivateAt: "2099-01-01T00:00:00Z" } },
      { id: "cooling", rateLimitedUntil: "2099-01-01T00:00:00Z" },
      { id: "recovered", rateLimitedUntil: "2020-01-01T00:00:00Z" },
      { id: "invalid-date", rateLimitedUntil: "invalid" },
    ];
    expect(filterAvailableAccounts(accounts, "excluded").map((account) => account.id))
      .toEqual(["recovered", "invalid-date"]);
  });
});
