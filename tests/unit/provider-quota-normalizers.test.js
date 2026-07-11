import { describe, expect, it } from "vitest";
import {
  PROVIDER_QUOTA_CONFIG,
  PROVIDER_QUOTA_UNSUPPORTED,
} from "../../open-sse/config/providerQuota.js";
import {
  parseQuotaTimestamp,
  quotaScopedKey,
} from "../../open-sse/services/quota/normalize.js";
import { normalizeGoogleQuota } from "../../open-sse/services/quota/providers/google.js";
import { normalizeCodexQuota } from "../../open-sse/services/quota/providers/codex.js";
import { normalizeClaudeLegacyQuota, normalizeClaudeQuota } from "../../open-sse/services/quota/providers/claude.js";
import { normalizeGitHubQuota } from "../../open-sse/services/quota/providers/github.js";
import {
  normalizeCursorDashboardQuota,
  normalizeCursorFallbackQuota,
} from "../../open-sse/services/quota/providers/cursor.js";
import { normalizeKiroQuota } from "../../open-sse/services/quota/providers/kiro.js";
import {
  normalizeBailianQuota,
  normalizeCodeBuddyQuota,
  normalizeGlmQuota,
  normalizeKimiQuota,
  normalizeMiniMaxQuota,
  normalizeQoderQuota,
} from "../../open-sse/services/quota/providers/codingPlans.js";
import {
  normalizeCrofQuota,
  normalizeDeepSeekQuota,
  normalizeVercelQuota,
} from "../../open-sse/services/quota/providers/balances.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const RESET = "2026-01-01T01:00:00.000Z";

describe("provider quota normalization primitives", () => {
  it.each([
    [1767229200, RESET],
    [1767229200000, RESET],
    [RESET, RESET],
    ["1767229200", RESET],
  ])("normalizes timestamp %#", (input, expected) => {
    expect(parseQuotaTimestamp(input)).toBe(expected);
  });

  it("preserves safe public keys and hashes private or secret-shaped values", () => {
    expect(quotaScopedKey("model", "gemini-2.5-pro")).toBe("model:gemini-2.5-pro");
    const privateKey = quotaScopedKey("account", "user@example.com", { privateValue: true });
    expect(privateKey).toMatch(/^account:h-[a-f0-9]{32}$/);
    expect(privateKey).not.toContain("user");
    const secretKey = quotaScopedKey("model", `token:${"A".repeat(80)}`);
    expect(secretKey).toMatch(/^model:h-[a-f0-9]{32}$/);
    expect(secretKey).not.toContain("token");
  });

  it("locks stable provider coverage and explicit non-persistence dispositions", () => {
    expect(Object.keys(PROVIDER_QUOTA_CONFIG)).toEqual([
      "gemini-cli", "antigravity", "agy", "codex", "claude", "github", "cursor", "kiro",
      "kimi-coding", "kimi-coding-apikey", "glm", "glm-cn", "zai", "glmt", "minimax", "minimax-cn",
      "codebuddy-cn", "bailian-coding-plan", "qoder", "qoder-cn", "vercel-ai-gateway", "crof", "deepseek",
    ]);
    expect(Object.keys(PROVIDER_QUOTA_CONFIG).filter((provider) => Object.hasOwn(PROVIDER_QUOTA_UNSUPPORTED, provider))).toEqual([]);
    expect(PROVIDER_QUOTA_UNSUPPORTED).toMatchObject({
      qwen: "local-or-message-only",
      xai: "local-history-only",
      opencode: "speculative-endpoint",
      ollama: "no-stable-quota-api",
      "xiaomi-mimo": "no-stable-quota-api",
      vertex: "billing-not-provider-quota",
      nanogpt: "provider-not-present",
    });
    for (const config of Object.values(PROVIDER_QUOTA_CONFIG)) {
      const urls = Object.entries(config).flatMap(([key, value]) => {
        if (/url$/i.test(key) && typeof value === "string") return [value];
        if (/urls$/i.test(key) && Array.isArray(value)) return value.map((entry) => typeof entry === "string" ? entry : entry.url);
        return [];
      });
      for (const raw of urls) {
        const url = new URL(raw.replace("{org_id}", "organization"));
        expect(url.protocol).toBe("https:");
        expect(url.username).toBe("");
        expect(url.password).toBe("");
      }
    }
  });
});

describe("Google and Codex quota normalizers", () => {
  it("preserves exact Gemini zero/full fractions and multi-account model identity", () => {
    const rows = normalizeGoogleQuota({ buckets: [
      { modelId: "gemini-pro", remainingFraction: 0, resetTime: RESET },
      { modelId: "gemini-flash", remainingFraction: 1, resetTime: RESET },
    ] }, { projectId: "project-secret", plan: "Standard", now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ state: "exhausted", amounts: { remainingRatio: 0 } });
    expect(rows[1]).toMatchObject({ state: "available", amounts: { remainingRatio: 1 } });
    expect(rows[0].accountKey).toMatch(/^project:h-/);
    expect(JSON.stringify(rows)).not.toContain("project-secret");
  });

  it.each([-0.1, 1.1, "bad"])("rejects an invalid Google fraction %s as a whole source", (remainingFraction) => {
    expect(normalizeGoogleQuota({ buckets: [
      { modelId: "valid", remainingFraction: 0.5 },
      { modelId: "invalid", remainingFraction },
    ] }, { projectId: "p", now: NOW })).toBeNull();
  });

  it("normalizes Codex normal, review, and Spark windows without account leakage", () => {
    const window = (used) => ({ used_percent: used, reset_at: 1767229200 });
    const rows = normalizeCodexQuota({
      plan_type: "team",
      rate_limit: { primary_window: window(100), secondary_window: window(25) },
      code_review_rate_limit: { primary_window: window(10), secondary_window: window(20) },
      additional_rate_limits: [{ limit_name: "codex-spark", rate_limit: { primary_window: window(50), secondary_window: window(60) } }],
    }, { accountId: "acct-secret", now: NOW });
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.state === "exhausted")).toHaveLength(1);
    expect(rows.map((row) => row.resourceKey)).toEqual(expect.arrayContaining([
      null,
      "feature:code-review",
      "model:codex-spark",
    ]));
    expect(JSON.stringify(rows)).not.toContain("acct-secret");
  });

  it("rejects malformed Codex percentages instead of defaulting them", () => {
    expect(normalizeCodexQuota({ rate_limit: { primary_window: { used_percent: 101 } } }, { now: NOW })).toBeNull();
  });

  it("does not treat an empty Codex payload as an authoritative clear", () => {
    expect(normalizeCodexQuota({}, { now: NOW })).toBeNull();
  });

  it.each([
    { rate_limits_by_limit_id: [] },
    { rate_limits_by_limit_id: { code_review: "malformed" } },
    { additional_rate_limits: {} },
    { additional_rate_limits: [{ rate_limit: { primary_window: { used_percent: 10 } } }, "malformed"] },
  ])("rejects a valid Codex primary window mixed with malformed collections", (extra) => {
    expect(normalizeCodexQuota({
      rate_limit: { primary_window: { used_percent: 10, reset_after_seconds: 60 } },
      ...extra,
    }, { now: NOW })).toBeNull();
  });

  it("accepts Codex camel aliases and expanded review/Spark descriptors", () => {
    const rows = normalizeCodexQuota({
      planType: "pro",
      rateLimit: { primaryWindow: { usedPercent: 10, resetAfterSeconds: 60 } },
      additionalRateLimits: [
        { limitId: "code-review", rateLimit: { primaryWindow: { usedPercent: 20 } } },
        { title: "Codex Spark", modelId: "codex-spark", rateLimit: { primaryWindow: { usedPercent: 30 } } },
      ],
    }, { now: NOW });
    expect(rows.map((row) => [row.resourceKey, row.amounts.remainingRatio])).toEqual([
      [null, 0.9],
      ["feature:code-review", 0.8],
      ["model:codex-spark", 0.7],
    ]);
    expect(rows.every((row) => row.metadata.plan === "pro")).toBe(true);
  });
});

describe("Claude, GitHub, and Cursor quota normalizers", () => {
  it("treats Claude utilization as percent used across model windows", () => {
    const rows = normalizeClaudeQuota({
      five_hour: { utilization: 90, resets_at: RESET },
      seven_day: { utilization: 10, resets_at: RESET },
      seven_day_sonnet: { utilization: 50, resets_at: RESET },
      seven_day_omelette: { utilization: 25, resets_at: RESET },
    }, { accountId: "org-secret", now: NOW });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ state: "low", amounts: { remainingRatio: 0.1 } });
    expect(rows[2].resourceKey).toBe("model:sonnet");
    expect(rows[3].resourceKey).toBe("model:designer");
    expect(JSON.stringify(rows)).not.toContain("org-secret");
  });

  it("rejects present malformed and empty Claude windows as a whole source", () => {
    expect(normalizeClaudeQuota({ five_hour: "invalid" }, { now: NOW })).toBeNull();
    expect(normalizeClaudeQuota({}, { now: NOW })).toBeNull();
  });

  it("normalizes the accepted Claude legacy admin usage shape without inventing a limit", () => {
    const rows = normalizeClaudeLegacyQuota({ weekly: { used: 10 } }, {
      accountId: "org-private",
      plan: "team",
      now: NOW,
    });
    expect(rows).toEqual([expect.objectContaining({
      dimensionKey: "requests:weekly",
      state: "unknown",
      amounts: { limitKind: "unknown", limit: null, used: 10, remaining: null, remainingRatio: null, unit: "requests" },
      metadata: { plan: "team" },
    })]);
    expect(JSON.stringify(rows)).not.toContain("org-private");
  });

  it("preserves GitHub paid entitlements and unlimited buckets", () => {
    const rows = normalizeGitHubQuota({
      copilot_plan: "business",
      quota_reset_date: RESET,
      quota_snapshots: {
        chat: { entitlement: 100, remaining: 0, unlimited: false },
        completions: { entitlement: 0, remaining: 0, unlimited: true },
      },
    }, { now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ state: "exhausted", amounts: { limit: 100, remaining: 0 } });
    expect(rows[1]).toMatchObject({ state: "available", amounts: { limitKind: "unlimited", limit: null } });
  });

  it("accepts GitHub paid used/total and percent-only snapshots", () => {
    const rows = normalizeGitHubQuota({
      quota_snapshots: {
        chat: { used: 25, total: 100 },
        premium_interactions: { percent_remaining: 30, total: 0 },
      },
    }, { now: NOW });
    expect(rows[0]).toMatchObject({ amounts: { limitKind: "bounded", limit: 100, used: 25, remaining: 75 } });
    expect(rows[1]).toMatchObject({ amounts: { limitKind: "unknown", remainingRatio: 0.3 } });
  });

  it("rejects a malformed present GitHub bucket instead of dropping it", () => {
    expect(normalizeGitHubQuota({
      quota_snapshots: { chat: { entitlement: 10, remaining: 5 }, completions: "invalid" },
    }, { now: NOW })).toBeNull();
  });

  it("treats GitHub limited_user_quotas as remaining, not used", () => {
    const rows = normalizeGitHubQuota({
      monthly_quotas: { chat: 50, completions: 100 },
      limited_user_quotas: { chat: 5, completions: 90 },
      limited_user_reset_date: RESET,
    }, { now: NOW });
    expect(rows[0].amounts).toMatchObject({ limit: 50, used: 45, remaining: 5, remainingRatio: 0.1 });
    expect(rows[1].amounts).toMatchObject({ limit: 100, used: 10, remaining: 90, remainingRatio: 0.9 });
  });

  it("normalizes Cursor spend and percentage windows without defaulting missing numbers", () => {
    const rows = normalizeCursorDashboardQuota({
      billingCycleEnd: RESET,
      planUsage: { totalSpend: 250, limit: 500, autoPercentUsed: 100, apiPercentUsed: 0 },
      spendLimitUsage: { individualUsed: 100, individualLimit: 1000 },
    }, { plan: "Pro", now: NOW });
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.dimensionKey === "spend:total").amounts).toMatchObject({ limit: 5, used: 2.5, unit: "usd" });
    expect(rows.find((row) => row.dimensionKey === "requests:auto-composer").state).toBe("exhausted");
    expect(normalizeCursorDashboardQuota({ planUsage: { totalSpend: "bad", limit: 500 } }, { now: NOW })).toBeNull();
  });

  it("normalizes Cursor fallback per-model request buckets", () => {
    const rows = normalizeCursorFallbackQuota({
      startOfMonth: RESET,
      "gpt-5": { numRequests: 2, maxRequestUsage: 10 },
    }, { now: NOW });
    expect(rows[0]).toMatchObject({ resourceKey: "model:gpt-5", amounts: { limit: 10, used: 2, remaining: 8 } });
  });
});

describe("provider plan quota normalizers", () => {
  it("normalizes Kiro subscription and free-trial resources", () => {
    const rows = normalizeKiroQuota({
      nextDateReset: RESET,
      subscriptionInfo: { subscriptionTitle: "Pro" },
      usageBreakdownList: [{
        resourceType: "AGENTIC_REQUEST",
        currentUsageWithPrecision: 10,
        usageLimitWithPrecision: 100,
        freeTrialInfo: { currentUsageWithPrecision: 5, usageLimitWithPrecision: 5, freeTrialExpiry: RESET },
      }],
    }, { accountKey: "account:h-1234", now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ state: "exhausted", metadata: { recurring: false } });
  });

  it("keeps empty Kiro breakdowns non-authoritative and honors overage", () => {
    expect(normalizeKiroQuota({ subscriptionInfo: { subscriptionTitle: "Pro" } }, { now: NOW })).toBeNull();
    const rows = normalizeKiroQuota({
      overageConfiguration: { overageStatus: "ENABLED" },
      usageBreakdownList: [{ resourceType: "AGENTIC_REQUEST", currentUsageWithPrecision: 120, usageLimitWithPrecision: 100 }],
    }, { now: NOW });
    expect(rows[0]).toMatchObject({ state: "available", amounts: { limitKind: "unlimited", used: 120 } });
  });

  it("treats Kimi utilization as percent remaining and exact bounded usage as authoritative", () => {
    const rows = normalizeKimiQuota({
      user: { membership: { level: "LEVEL_BASIC" } },
      usage: { limit: "100", used: "92", remaining: "8", resetTime: RESET },
      five_hour: { utilization: 80, resets_at: RESET },
    }, { now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ state: "low", metadata: { plan: "Moderato" } });
    expect(rows[1].amounts.remainingRatio).toBeCloseTo(0.8);
  });

  it("rejects empty or present malformed Kimi quota sources", () => {
    expect(normalizeKimiQuota({}, { now: NOW })).toBeNull();
    expect(normalizeKimiQuota({ usage: "invalid" }, { now: NOW })).toBeNull();
    expect(normalizeKimiQuota({ limits: {} }, { now: NOW })).toBeNull();
  });

  it("normalizes GLM exact zero and rejects out-of-range percentages", () => {
    const rows = normalizeGlmQuota({ data: { level: "PRO", limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 0, nextResetTime: 1767229200000 }] } }, { now: NOW });
    expect(rows[0]).toMatchObject({ state: "available", amounts: { remainingRatio: 1 } });
    expect(normalizeGlmQuota({ data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: -1 }] } }, { now: NOW })).toBeNull();
  });

  it("keeps GLM 5h, weekly, and team tool windows distinct", () => {
    const rows = normalizeGlmQuota({ data: { level: "PRO", limits: [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10, nextResetTime: 1767229200000 },
      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 20, nextResetTime: 1767229200000 },
      { type: "TIME_LIMIT", unit: 5, number: 1, usage: 1000, currentValue: 43, remaining: 957, percentage: 4, nextResetTime: 1767229200000 },
    ] } }, { now: NOW });
    expect(rows.map((row) => row.dimensionKey)).toEqual(["tokens:session", "tokens:weekly", "tools:monthly"]);
    expect(rows[2].amounts).toMatchObject({ limit: 1000, used: 43, remaining: 957, unit: "tools" });
  });

  it("rejects an unknown GLM token window instead of inventing a dimension", () => {
    expect(normalizeGlmQuota({ data: { limits: [
      { type: "TOKENS_LIMIT", unit: 9, number: 99, percentage: 10 },
    ] } }, { now: NOW })).toBeNull();
  });

  it.each([
    ["used", 25, 75],
    ["remaining", 75, 75],
  ])("infers MiniMax %s count semantics from payload consistency", (_semantics, count, expectedRemaining) => {
    const rows = normalizeMiniMaxQuota({ model_remains: [{
      model_name: "MiniMax-M*",
      current_interval_total_count: 100,
      current_interval_usage_count: count,
      current_interval_remaining_percent: 75,
      remains_time: 3_600_000,
    }] }, { now: NOW });
    expect(rows[0].amounts.remaining).toBe(expectedRemaining);
    expect(rows[0].timing).toBeUndefined();
    expect(rows[0].resetAt).toBe(RESET);
  });

  it("uses one representative MiniMax text-plan window and excludes media buckets", () => {
    const rows = normalizeMiniMaxQuota({ model_remains: [
      { model_name: "video", current_interval_total_count: 9999, current_interval_usage_count: 1 },
      { model_name: "MiniMax-M2", current_interval_total_count: 100, current_interval_usage_count: 25, current_interval_remaining_percent: 75 },
      { model_name: "general", current_interval_total_count: 200, current_interval_usage_count: 50, current_interval_remaining_percent: 75 },
    ] }, { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resourceKey: null, amounts: { limit: 200, used: 50, remaining: 150 } });
  });

  it("rejects ambiguous or out-of-range MiniMax counts", () => {
    const payload = (count, percent) => ({ model_remains: [{
      model_name: "MiniMax-M2",
      current_interval_total_count: 100,
      current_interval_usage_count: count,
      current_interval_remaining_percent: percent,
    }] });
    expect(normalizeMiniMaxQuota(payload(50, 50), { now: NOW })).toBeNull();
    expect(normalizeMiniMaxQuota(payload(125, 0), { now: NOW })).toBeNull();
  });

  it("keeps CodeBuddy recurring and bonus packages separate", () => {
    const rows = normalizeCodeBuddyQuota({ code: 0, data: { Response: { Data: { Accounts: [
      {
        PackageType: "subscription",
        PackageName: "Monthly Base",
        CycleStartTime: "2025-12-01T01:00:00Z",
        CycleEndTime: RESET,
        DeductionEndTime: "2026-06-01T00:00:00Z",
        CycleCapacityUsedPrecise: "6.5",
        CycleCapacitySizePrecise: "500",
      },
      {
        PackageType: "bonus",
        PackageName: "Promo",
        CycleStartTime: "2025-12-01T01:00:00Z",
        CycleEndTime: RESET,
        DeductionEndTime: RESET,
        CapacityUsedPrecise: "1",
        CapacitySizePrecise: "10",
      },
    ] } } } }, { now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.metadata.recurring)).toEqual([true, false]);
  });

  it("assigns CodeBuddy package identities by expiry rather than upstream order", () => {
    const account = (name, end) => ({
      PackageName: name,
      CycleStartTime: "2025-12-01T00:00:00Z",
      CycleEndTime: end,
      DeductionEndTime: end,
      CapacityUsedPrecise: "1",
      CapacitySizePrecise: "10",
    });
    const payload = (accounts) => ({ code: 0, data: { Response: { Data: { Accounts: accounts } } } });
    const early = account("Early", "2026-01-01T00:30:00Z");
    const late = account("Late", "2026-01-01T01:00:00Z");
    const first = normalizeCodeBuddyQuota(payload([late, early]), { now: NOW });
    const second = normalizeCodeBuddyQuota(payload([early, late]), { now: NOW });
    expect(first.map((row) => [row.resourceKey, row.metadata.displayName])).toEqual(second.map((row) => [row.resourceKey, row.metadata.displayName]));
    expect(first[0]).toMatchObject({ resourceKey: "package:bonus-1", metadata: { displayName: "Early" } });
  });

  it("derives CodeBuddy recurrence from dates even when the payload boolean disagrees", () => {
    const rows = normalizeCodeBuddyQuota({ code: 0, data: { Response: { Data: { Accounts: [{
      Recurring: true,
      PackageName: "One-off",
      CycleStartTime: "2025-12-01T00:00:00Z",
      CycleEndTime: RESET,
      DeductionEndTime: "2026-01-02T00:00:00Z",
      CapacityUsedPrecise: 1,
      CapacitySizePrecise: 10,
    }] } } } }, { now: NOW });
    expect(rows[0]).toMatchObject({ resourceKey: "package:bonus-1", metadata: { recurring: false } });
  });

  it("normalizes Bailian 5h/weekly/monthly windows", () => {
    const rows = normalizeBailianQuota({
      code: "Success",
      data: { codingPlanInstanceInfos: [{ codingPlanQuotaInfo: {
        per5HourUsedQuota: 10, per5HourTotalQuota: 100, per5HourQuotaNextRefreshTime: 1767229200,
        perWeekUsedQuota: 20, perWeekTotalQuota: 200, perWeekQuotaNextRefreshTime: 1767229200,
        perBillMonthUsedQuota: 30, perBillMonthTotalQuota: 300, perBillMonthQuotaNextRefreshTime: 1767229200,
      } }] },
    }, { now: NOW });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.dimensionKey)).toEqual(["requests:session", "requests:weekly", "requests:monthly"]);
  });

  it("keeps Qoder zero totals unknown rather than unlimited", () => {
    const rows = normalizeQoderQuota({
      expiresAt: 1767229200000,
      isQuotaExceeded: false,
      userQuota: { total: 0, used: 0, remaining: 0, unit: "credits" },
      orgResourcePackage: { total: 100, used: 25, remaining: 75, unit: "credits" },
    }, { now: NOW });
    expect(rows[0].amounts.limitKind).toBe("unknown");
    expect(rows[0].state).toBe("exhausted");
    expect(rows[0].amounts.limitKind).not.toBe("unlimited");
    expect(rows[1].amounts).toMatchObject({ limitKind: "bounded", limit: 100, remaining: 75 });
  });

  it("maps accepted Qoder team and individual status payloads without false exhaustion", () => {
    const pooled = normalizeQoderQuota({
      userType: "teams", userTag: "Teams", plan: "PLAN_TIER_TEAM", quota: 0,
      isQuotaExceeded: false, nextResetAt: 1767229200000,
    }, { now: NOW });
    expect(pooled[0]).toMatchObject({ state: "available", amounts: { limitKind: "unlimited", remaining: null } });
    const individual = normalizeQoderQuota({
      userType: "individual", plan: "PLAN_TIER_PRO", quota: 42,
      isQuotaExceeded: false, nextResetAt: 1767229200000,
    }, { now: NOW });
    expect(individual[0]).toMatchObject({ state: "available", amounts: { limitKind: "unknown", remaining: 42 } });
    const individualZero = normalizeQoderQuota({
      userType: "individual", plan: "PLAN_TIER_PRO", quota: 0,
      isQuotaExceeded: false, nextResetAt: 1767229200000,
    }, { now: NOW });
    expect(individualZero[0]).toMatchObject({ state: "exhausted", amounts: { limitKind: "unknown", remaining: 0 } });
  });

  it("rejects a malformed present Qoder bucket as a whole source", () => {
    expect(normalizeQoderQuota({
      userQuota: { total: 100, used: 10, remaining: 90 },
      orgResourcePackage: { total: "invalid", remaining: 5 },
    }, { now: NOW })).toBeNull();
  });
});

describe("provider balance normalizers", () => {
  it("does not invent a Vercel monthly allocation", () => {
    const rows = normalizeVercelQuota({ balance: "4.50", total_used: "0.50" });
    expect(rows[0].amounts).toEqual({
      limitKind: "unknown", limit: null, used: 0.5, remaining: 4.5, remainingRatio: null, unit: "usd",
    });
  });

  it("keeps Crof daily requests and credits as separate unknown-limit dimensions", () => {
    const rows = normalizeCrofQuota({ usable_requests: 0, credits: 12.5 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ state: "exhausted", dimensionKey: "requests:daily" });
    expect(rows[1]).toMatchObject({ state: "available", dimensionKey: "balance:usd" });
  });

  it("does not let an empty Crof payload authoritatively clear prior quota", () => {
    expect(normalizeCrofQuota({})).toBeNull();
  });

  it("keeps DeepSeek currency balances without fake percentages", () => {
    const rows = normalizeDeepSeekQuota({
      is_available: true,
      balance_infos: [{ currency: "USD", total_balance: "0", granted_balance: "0", topped_up_balance: "0" }],
    });
    expect(rows[0]).toMatchObject({
      state: "exhausted",
      resourceKey: "currency:usd",
      amounts: { limitKind: "unknown", remaining: 0, remainingRatio: null, unit: "usd" },
    });
  });

  it("does not let an empty DeepSeek balance list authoritatively clear prior quota", () => {
    expect(normalizeDeepSeekQuota({ is_available: true, balance_infos: [] })).toBeNull();
  });

  it("rejects a secret-shaped DeepSeek currency before it can become a unit", () => {
    expect(normalizeDeepSeekQuota({
      is_available: true,
      balance_infos: [{ currency: "sk-secret-unit-123456", total_balance: 1 }],
    })).toBeNull();
  });
});
