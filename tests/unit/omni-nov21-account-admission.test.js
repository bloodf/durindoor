import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkFallbackError,
  getEarliestRateLimitedUntil,
  isTerminalAccount,
} from "../../open-sse/services/accountFallback.js";
import { evaluateProviderQuotaPreflight } from "../../src/shared/services/providerQuotaPreflight.js";
import { normalizeQuotaSnapshot } from "../../src/shared/utils/quotaSnapshot.js";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OmniRoute #19684: DashScope unpaid account classification", () => {
  const arrearage = JSON.stringify({
    error: { code: "Arrearage", message: "Access denied, please make sure your account is in good standing." },
  });
  const unpurchased = JSON.stringify({
    error: {
      code: "AccessDenied.Unpurchased",
      message: "Access to model denied. Please make sure you are eligible for using the model.",
    },
  });

  it("parks a 400 Arrearage key on the terminal billing cooldown instead of keeping it request-scoped", () => {
    const result = checkFallbackError(400, arrearage, 0, "alibaba-cn");
    expect(result).toMatchObject({ shouldFallback: true, terminal: true });
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.requestScoped).toBeUndefined();
  });

  it("parks a 403 AccessDenied.Unpurchased key as terminal", () => {
    expect(checkFallbackError(403, unpurchased, 0, "alibaba-cn")).toMatchObject({
      shouldFallback: true,
      terminal: true,
    });
  });

  it("recognises the vendor code from a structured body when the text carries no marker", () => {
    expect(checkFallbackError(400, "bad request", 0, "alibaba-cn", null, { error: { code: "Arrearage" } }))
      .toMatchObject({ shouldFallback: true, terminal: true });
    expect(checkFallbackError(403, "forbidden", 0, "alibaba-cn", null, { code: "AccessDenied.Unpurchased" }))
      .toMatchObject({ shouldFallback: true, terminal: true });
  });

  it("keeps a 429 that merely quotes the good-standing sentence on the transient throttle path", () => {
    const result = checkFallbackError(429, "please make sure your account is in good standing", 0, "alibaba-cn");
    expect(result.shouldFallback).toBe(true);
    expect(result.terminal).toBeUndefined();
    expect(result.newBackoffLevel).toBe(1);
  });

  it("does not treat generic AccessDenied or unrelated 400s as a dead account", () => {
    expect(checkFallbackError(403, "AccessDenied: model not allowed", 0, "alibaba-cn").terminal).toBeUndefined();
    expect(checkFallbackError(400, "model_not_found", 0, "alibaba-cn")).toMatchObject({
      shouldFallback: false,
      requestScoped: true,
    });
  });
});

describe("OmniRoute #19769: deactivated accounts and retry hints", () => {
  const cooling = (extra = {}) => ({
    id: "cooling",
    rateLimitedUntil: new Date(NOW + 120_000).toISOString(),
    ...extra,
  });
  const deactivated = (extra = {}) => ({
    id: "dead",
    testStatus: "deactivated",
    rateLimitedUntil: new Date(NOW + 60_000).toISOString(),
    ...extra,
  });

  it("classifies deactivated, banned, expired, credits-exhausted and switched-off accounts as terminal", () => {
    for (const testStatus of ["deactivated", " DeAcTiVaTeD ", "banned", "expired", "credits_exhausted"]) {
      expect(isTerminalAccount({ testStatus })).toBe(true);
    }
    expect(isTerminalAccount({ status: "deactivated" })).toBe(true);
    expect(isTerminalAccount({ isActive: false })).toBe(true);
    expect(isTerminalAccount({ testStatus: "active" })).toBe(false);
    expect(isTerminalAccount({ testStatus: "unavailable" })).toBe(false);
    expect(isTerminalAccount(null)).toBe(false);
  });

  it("returns no retry hint for a deactivated-only pool", () => {
    expect(getEarliestRateLimitedUntil([deactivated()])).toBeNull();
    expect(getEarliestRateLimitedUntil([deactivated({ testStatus: " DeAcTiVaTeD " })])).toBeNull();
  });

  it("does not let a deactivated account shorten a cooling sibling's retry hint", () => {
    expect(getEarliestRateLimitedUntil([deactivated(), cooling()])).toBe(new Date(NOW + 120_000).toISOString());
  });

  it("gives no cooldown hint when a healthy sibling sits beside a deactivated account", () => {
    expect(getEarliestRateLimitedUntil([deactivated(), { id: "healthy" }])).toBeNull();
  });

  it("still picks the earliest of several temporary cooldowns", () => {
    const sooner = cooling({ id: "sooner", rateLimitedUntil: new Date(NOW + 30_000).toISOString() });
    expect(getEarliestRateLimitedUntil([cooling(), sooner, deactivated()])).toBe(new Date(NOW + 30_000).toISOString());
  });
});

describe("OmniRoute #20355: expired quota reset windows", () => {
  function row({
    state = "exhausted",
    resetAt = null,
    staleAt = NOW + 3_600_000,
    observedAt = NOW - 7_200_000,
    dimensionKey = "requests:session",
  } = {}) {
    return {
      identity: {
        connectionId: "conn-1",
        provider: "codex",
        accountKey: "scope:connection",
        resourceKey: "scope:account",
        dimensionKey,
      },
      state,
      amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
      timing: {
        observedAt: new Date(observedAt).toISOString(),
        staleAt: new Date(staleAt).toISOString(),
        resetAt: resetAt === null ? null : typeof resetAt === "number" ? new Date(resetAt).toISOString() : resetAt,
        cooldownUntil: null,
      },
      provenance: { sourceType: "provider_api", sourceId: "codex:wham-usage:v1", reasonCode: null, metadata: {} },
    };
  }

  // Persisted rows pass through normalizeQuotaSnapshot, which caps staleAt at resetAt.
  const persisted = (options) => normalizeQuotaSnapshot(row(options), { allowCanonicalSentinels: true });
  const evaluate = (rows) =>
    evaluateProviderQuotaPreflight(rows, {
      connectionId: "conn-1",
      provider: "codex",
      now: NOW,
      refreshSupported: true,
    });

  it("keeps an exhausted window blocking until its valid reset", () => {
    const decision = evaluate([persisted({ resetAt: NOW + 1_000 })]);
    expect(decision).toMatchObject({ skip: true, reason: "exhausted", retryAt: new Date(NOW + 1_000).toISOString() });
  });

  it("releases a window exactly at its reset and after it", () => {
    for (const resetAt of [NOW, NOW - 1_000, NOW - 60_000]) {
      const decision = evaluate([persisted({ resetAt })]);
      expect(decision).toMatchObject({ eligible: true, skip: false, shouldRefresh: true });
    }
  });

  it("releases an expired window when another window is available", () => {
    const decision = evaluate([
      persisted({ resetAt: NOW - 1_000 }),
      persisted({ state: "available", dimensionKey: "requests:week" }),
    ]);
    expect(decision).toMatchObject({ eligible: true, skip: false });
  });

  it("keeps a missing reset restricted while the observation is fresh", () => {
    const decision = evaluate([persisted({ resetAt: null })]);
    expect(decision).toMatchObject({ skip: true, reason: "exhausted", retryAt: null });
  });

  it("keeps a malformed reset restricted and never fabricates a retry deadline", () => {
    expect(() => persisted({ resetAt: "not-a-date" })).toThrow();
    const decision = evaluate([row({ resetAt: "not-a-date" })]);
    expect(decision).toMatchObject({ skip: true, reason: "exhausted", retryAt: null });
  });

  it("keeps blocking on a still-exhausted window beside one whose reset has passed", () => {
    const decision = evaluate([
      persisted({ resetAt: NOW - 1_000 }),
      persisted({ resetAt: NOW + 86_400_000, dimensionKey: "requests:week" }),
    ]);
    expect(decision).toMatchObject({ skip: true, reason: "exhausted" });
    expect(decision.retryAt).toBe(new Date(NOW + 86_400_000).toISOString());
  });
});
