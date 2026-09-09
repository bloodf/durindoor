// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  MERGE_MODE,
  QUOTA_MERGED_VIEW_STORAGE_KEY,
  getQuotaMergeKey,
  groupConnectionsByProvider,
  mergeAccountQuotas,
  readMergedViewMap,
  writeMergedViewPreference,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/grouping.js";

describe("groupConnectionsByProvider", () => {
  it("buckets connections of the same provider into one group", () => {
    const groups = groupConnectionsByProvider([
      { id: "codex-1", provider: "codex" },
      { id: "claude-1", provider: "claude" },
      { id: "codex-2", provider: "codex" },
      { id: "codex-3", provider: "codex" },
      { id: "claude-2", provider: "claude" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].provider).toBe("codex");
    expect(groups[0].connections.map((c) => c.id)).toEqual(["codex-1", "codex-2", "codex-3"]);
    expect(groups[1].provider).toBe("claude");
    expect(groups[1].connections.map((c) => c.id)).toEqual(["claude-1", "claude-2"]);
  });

  it("preserves provider first-appearance order and per-provider connection order", () => {
    const groups = groupConnectionsByProvider([
      { id: "b-2", provider: "beta" },
      { id: "a-1", provider: "alpha" },
      { id: "b-1", provider: "beta" },
    ]);

    expect(groups.map((group) => group.provider)).toEqual(["beta", "alpha"]);
    expect(groups[0].connections.map((c) => c.id)).toEqual(["b-2", "b-1"]);
  });

  it("gives single-connection providers a one-account group", () => {
    const groups = groupConnectionsByProvider([{ id: "xai-1", provider: "xai" }]);
    expect(groups).toEqual([{ provider: "xai", connections: [{ id: "xai-1", provider: "xai" }] }]);
  });

  it("returns an empty list for missing or non-array input", () => {
    expect(groupConnectionsByProvider()).toEqual([]);
    expect(groupConnectionsByProvider(null)).toEqual([]);
    expect(groupConnectionsByProvider("nope")).toEqual([]);
  });
});

describe("mergeAccountQuotas", () => {
  it("sums used/total when every account reports absolute values", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "primary", used: 300, total: 1000, resetAt: "2026-09-10T00:00:00Z" }] },
      { connectionId: "b", quotas: [{ name: "primary", used: 100, total: 1000, resetAt: "2026-09-12T00:00:00Z" }] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].mergeMode).toBe(MERGE_MODE.ABSOLUTE);
    expect(merged[0].used).toBe(400);
    expect(merged[0].total).toBe(2000);
    expect(merged[0].accountCount).toBe(2);
    expect(merged[0].sourceConnectionIds).toEqual(["a", "b"]);
  });

  it("collapses reset windows to the soonest reset across accounts", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "primary", used: 0, total: 100, resetAt: "2026-09-12T00:00:00Z" }] },
      { connectionId: "b", quotas: [{ name: "primary", used: 0, total: 100, resetAt: "2026-09-10T00:00:00Z" }] },
      { connectionId: "c", quotas: [{ name: "primary", used: 0, total: 100, resetAt: "2026-09-12T00:00:00Z" }] },
    ]);

    expect(merged[0].resetAt).toBe(new Date("2026-09-10T00:00:00Z").toISOString());
  });

  it("falls back to the min remaining percentage when any account reports only percentages", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "weekly", used: 200, total: 1000 }] },
      { connectionId: "b", quotas: [{ name: "weekly", used: 0, total: 0, remainingPercentage: 42 }] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].mergeMode).toBe(MERGE_MODE.PERCENTAGE);
    // Account a: (1000-200)/1000 = 80%; account b: 42% → min wins.
    expect(merged[0].remainingPercentage).toBe(42);
    // No fabricated absolutes.
    expect(merged[0].used).toBe(0);
    expect(merged[0].total).toBe(0);
  });

  it("never fabricates totals when all accounts report only percentages", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "session", used: 0, total: 0, remainingPercentage: 90 }] },
      { connectionId: "b", quotas: [{ name: "session", used: 0, total: 0, remainingPercentage: 55 }] },
      { connectionId: "c", quotas: [{ name: "session", used: 0, total: 0, remainingPercentage: 70 }] },
    ]);

    expect(merged[0].mergeMode).toBe(MERGE_MODE.PERCENTAGE);
    expect(merged[0].remainingPercentage).toBe(55);
    expect(merged[0].total).toBe(0);
  });

  it("treats credit-balance rows as percentage-only so balances are not summed as window totals", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "extra_usage", isCredits: true, used: 10, total: 100, remainingPercentage: 90 }] },
      { connectionId: "b", quotas: [{ name: "extra_usage", isCredits: true, used: 60, total: 100, remainingPercentage: 40 }] },
    ]);

    expect(merged[0].mergeMode).toBe(MERGE_MODE.PERCENTAGE);
    expect(merged[0].remainingPercentage).toBe(40);
    expect(merged[0].total).toBe(0);
  });

  it("keeps quotas that only one account reports, with their own accountCount", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [
        { name: "primary", used: 10, total: 100 },
        { name: "secondary", used: 5, total: 50 },
      ] },
      { connectionId: "b", quotas: [{ name: "primary", used: 20, total: 100 }] },
    ]);

    expect(merged.map((row) => row.name)).toEqual(["primary", "secondary"]);
    expect(merged[0].accountCount).toBe(2);
    expect(merged[0].used).toBe(30);
    expect(merged[1].accountCount).toBe(1);
    expect(merged[1].used).toBe(5);
  });

  it("prefers modelKey over display name when matching quotas across accounts", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "Gemini Pro (High)", modelKey: "gemini-pro-high", used: 1, total: 10 }] },
      { connectionId: "b", quotas: [{ name: "Gemini Pro (High)", modelKey: "gemini-pro-high", used: 2, total: 10 }] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].modelKey).toBe("gemini-pro-high");
    expect(merged[0].used).toBe(3);
  });

  it("marks the merged row non-recurring when any contributor's window does not recur", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "bonus", used: 1, total: 10, recurring: true }] },
      { connectionId: "b", quotas: [{ name: "bonus", used: 1, total: 10, recurring: false }] },
    ]);

    expect(merged[0].recurring).toBe(false);
  });

  it("returns null resetAt when no account reports a parseable reset", () => {
    const merged = mergeAccountQuotas([
      { connectionId: "a", quotas: [{ name: "primary", used: 1, total: 10, resetAt: null }] },
      { connectionId: "b", quotas: [{ name: "primary", used: 1, total: 10, resetAt: "not-a-date" }] },
    ]);

    expect(merged[0].resetAt).toBeNull();
  });

  it("skips rows without a name or modelKey and handles empty input", () => {
    expect(mergeAccountQuotas()).toEqual([]);
    expect(mergeAccountQuotas(null)).toEqual([]);
    expect(mergeAccountQuotas([{ connectionId: "a", quotas: [{ used: 1, total: 10 }] }])).toEqual([]);
    expect(mergeAccountQuotas([{ connectionId: "a" }])).toEqual([]);
  });
});

describe("getQuotaMergeKey", () => {
  it("prefers modelKey, falls back to trimmed name, and rejects empty identities", () => {
    expect(getQuotaMergeKey({ modelKey: "m-1", name: "Display" })).toBe("m-1");
    expect(getQuotaMergeKey({ name: "  Weekly  " })).toBe("Weekly");
    expect(getQuotaMergeKey({})).toBe("");
    expect(getQuotaMergeKey(null)).toBe("");
  });
});

describe("merged-view preference storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the toggle per provider and removes disabled entries", () => {
    expect(readMergedViewMap()).toEqual({});

    writeMergedViewPreference("codex", true);
    writeMergedViewPreference("claude", true);
    expect(readMergedViewMap()).toEqual({ codex: true, claude: true });

    writeMergedViewPreference("codex", false);
    expect(readMergedViewMap()).toEqual({ claude: true });
    expect(window.localStorage.getItem(QUOTA_MERGED_VIEW_STORAGE_KEY)).toBe(JSON.stringify({ claude: true }));
  });

  it("ignores corrupt stored values and invalid providers", () => {
    window.localStorage.setItem(QUOTA_MERGED_VIEW_STORAGE_KEY, "{not json");
    expect(readMergedViewMap()).toEqual({});

    window.localStorage.setItem(QUOTA_MERGED_VIEW_STORAGE_KEY, JSON.stringify(["codex"]));
    expect(readMergedViewMap()).toEqual({});

    writeMergedViewPreference("", true);
    expect(readMergedViewMap()).toEqual({});
  });
});
