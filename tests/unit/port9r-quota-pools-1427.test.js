import { describe, expect, it } from "vitest";
import { getConnectionQuotaRemaining, isQuotaCollectionDepleted } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("multi-pool quota decisions", () => {
  it("keeps an account active and sorts by its best pool", () => {
    const quotas = [{ used: 50, total: 50 }, { used: 0, total: 500 }];
    expect(isQuotaCollectionDepleted(quotas)).toBe(false);
    expect(getConnectionQuotaRemaining({ id: "a" }, { a: { quotas } })).toBe(100);
  });

  it("uses percentages for credit rows and depletes only when all pools are low", () => {
    const quotas = [{ isCredits: true, remaining: 4000, remainingPercentage: 3 }, { remaining: 1 }];
    expect(isQuotaCollectionDepleted(quotas)).toBe(true);
    expect(getConnectionQuotaRemaining({ id: "a" }, { a: { quotas } })).toBe(3);
  });

  it("does not treat absent or unlimited quotas as depleted", () => {
    expect(isQuotaCollectionDepleted([])).toBe(false);
    expect(isQuotaCollectionDepleted([{ used: 10, total: 10 }, { unlimited: true }])).toBe(false);
    expect(getConnectionQuotaRemaining({ id: "a" }, {})).toBe(Infinity);
  });
});
