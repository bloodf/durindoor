import { describe, expect, it } from "vitest";
import {
  QuotaSnapshotValidationError,
  isQuotaSnapshotFresh,
  normalizeQuotaFetchState,
  normalizeQuotaSnapshot,
  quotaIdentityKey,
  canonicalizeQuotaNow,
} from "../../src/shared/utils/quotaSnapshot.js";

function makeSnapshot(overrides = {}) {
  return {
    identity: {
      connectionId: "conn-1",
      provider: "gemini",
      dimensionKey: "requests:session-5h",
      ...(overrides.identity || {}),
    },
    state: overrides.state || "available",
    amounts: {
      limitKind: "bounded",
      limit: 100,
      used: 75,
      remaining: 25,
      remainingRatio: 0.25,
      unit: "requests",
      ...(overrides.amounts || {}),
    },
    timing: {
      observedAt: "2026-01-01T03:00:00+03:00",
      staleAt: "2026-01-01T01:00:00.000Z",
      resetAt: null,
      cooldownUntil: null,
      ...(overrides.timing || {}),
    },
    provenance: {
      sourceType: "provider_api",
      sourceId: "gemini:quota:v1",
      reasonCode: null,
      metadata: { displayName: "Session quota", plan: "free", recurring: true, windowSeconds: 18_000 },
      ...(overrides.provenance || {}),
    },
  };
}

describe("provider quota snapshot contract", () => {
  it("canonicalizes identity defaults, UTC timestamps, metadata, and explicit zeroes", () => {
    const normalized = normalizeQuotaSnapshot(makeSnapshot({
      amounts: { used: 100, remaining: 0, remainingRatio: 0 },
      timing: { resetAt: "2026-01-01T00:30:00.000Z" },
    }));

    expect(normalized).toEqual({
      identity: {
        connectionId: "conn-1",
        provider: "gemini",
        accountKey: "scope:connection",
        resourceKey: "scope:account",
        dimensionKey: "requests:session-5h",
      },
      state: "available",
      amounts: {
        limitKind: "bounded",
        limit: 100,
        used: 100,
        remaining: 0,
        remainingRatio: 0,
        unit: "requests",
      },
      timing: {
        observedAt: "2026-01-01T00:00:00.000Z",
        staleAt: "2026-01-01T00:30:00.000Z",
        resetAt: "2026-01-01T00:30:00.000Z",
        cooldownUntil: null,
      },
      provenance: {
        sourceType: "provider_api",
        sourceId: "gemini:quota:v1",
        reasonCode: null,
        metadata: { displayName: "Session quota", plan: "free", recurring: true, windowSeconds: 18_000 },
      },
    });
  });

  it.each(["available", "low", "exhausted", "unknown", "error"])("accepts the %s state", (state) => {
    expect(normalizeQuotaSnapshot(makeSnapshot({ state })).state).toBe(state);
  });

  it("requires a bounded cooldown and keeps missing amounts distinct from zero", () => {
    const normalized = normalizeQuotaSnapshot(makeSnapshot({
      state: "cooldown",
      amounts: { limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null },
      timing: { cooldownUntil: "2026-01-01T00:10:00.000Z" },
      provenance: { reasonCode: "rate_limited" },
    }));
    expect(normalized.amounts).toEqual({ limitKind: "unknown", limit: null, used: null, remaining: null, remainingRatio: null, unit: null });
    expect(normalized.timing.staleAt).toBe("2026-01-01T00:10:00.000Z");
  });

  it("represents unlimited quota explicitly instead of inferring it from missing data", () => {
    const unlimited = normalizeQuotaSnapshot(makeSnapshot({
      amounts: { limitKind: "unlimited", limit: null, used: 12.5, remaining: null, remainingRatio: null },
    }));
    expect(unlimited.amounts).toMatchObject({ limitKind: "unlimited", limit: null, used: 12.5 });
  });

  it("uses collision-safe serialized identities", () => {
    const left = quotaIdentityKey({ connectionId: "c", provider: "p", accountKey: "account:a-b", resourceKey: "model:c", dimensionKey: "requests:d" });
    const right = quotaIdentityKey({ connectionId: "c", provider: "p", accountKey: "account:a", resourceKey: "model:b-c", dimensionKey: "requests:d" });
    expect(left).not.toBe(right);
  });

  it("reserves synthesized scope sentinels from provider input", () => {
    expect(() => normalizeQuotaSnapshot(makeSnapshot({ identity: { accountKey: "scope:connection" } }))).toThrow("reserved");
    expect(() => normalizeQuotaSnapshot(makeSnapshot({ identity: { resourceKey: "scope:account" } }))).toThrow("reserved");
    const normalized = normalizeQuotaSnapshot(makeSnapshot());
    expect(normalizeQuotaSnapshot(normalized, { allowCanonicalSentinels: true })).toEqual(normalized);
  });

  it.each([
    ["account key", { identity: { accountKey: "account:sk-deadbeef" } }],
    ["resource key", { identity: { resourceKey: "model:ghp_abcdefghijklmnopqrstuvwxyz123456" } }],
    ["dimension key", { identity: { dimensionKey: "requests:sk-deadbeef" } }],
    ["source id", { provenance: { sourceId: "gemini:https://provider.example/quota" } }],
    ["connection id", { identity: { connectionId: "user@example.com" } }],
    ["provider", { identity: { provider: "sk-deadbeef" } }],
    ["opaque account payload", { identity: { accountKey: `account:${"A".repeat(80)}` } }],
    ["nested opaque account payload", { identity: { accountKey: `account:id:${"A".repeat(80)}` } }],
    ["nested token account payload", { identity: { accountKey: `account:x:token:${"A".repeat(80)}` } }],
    ["nested bearer account payload", { identity: { accountKey: `account:x:bearer:${"A".repeat(80)}` } }],
    ["credential namespace", { identity: { accountKey: "token:abcdefghijklmnop" } }],
    ["transport source namespace", { provenance: { sourceId: "https:provider-secret" } }],
  ])("rejects secret or raw data in the %s without echoing it", (_label, overrides) => {
    const candidate = makeSnapshot(overrides);
    const canary = Object.values(overrides.identity || overrides.provenance)[0];
    const error = (() => {
      try { normalizeQuotaSnapshot(candidate); } catch (caught) { return caught; }
      return null;
    })();
    expect(error).toBeInstanceOf(QuotaSnapshotValidationError);
    expect(error.message).not.toContain(canary);
  });

  it.each([
    ["numeric strings", { amounts: { limit: "100" } }],
    ["negative amounts", { amounts: { used: -1 } }],
    ["unsafe amounts", { amounts: { remaining: Number.MAX_SAFE_INTEGER + 2 } }],
    ["NaN", { amounts: { remaining: Number.NaN } }],
    ["infinity", { amounts: { remaining: Number.POSITIVE_INFINITY } }],
    ["ratios above one", { amounts: { remainingRatio: 1.1 } }],
    ["inconsistent absolute amounts", { amounts: { used: 70, remaining: 40 } }],
    ["inconsistent ratio", { amounts: { remainingRatio: 0.5 } }],
    ["finite unlimited remaining", { amounts: { limitKind: "unlimited", limit: null, remaining: 25, remainingRatio: null } }],
    ["local timestamps", { timing: { observedAt: "2026-01-01T00:00:00" } }],
    ["invalid calendar dates", { timing: { observedAt: "2026-02-30T00:00:00Z" } }],
    ["stale before observed", { timing: { staleAt: "2025-12-31T23:59:59Z" } }],
    ["freshness beyond 24 hours", { timing: { staleAt: "2026-01-02T00:00:01Z" } }],
    ["unknown states", { state: "healthy" }],
    ["cooldown without a deadline", { state: "cooldown" }],
    ["unknown metadata keys", { provenance: { metadata: { rawResponse: "safe-looking" } } }],
    ["credential-like metadata values", { provenance: { metadata: { plan: "Bearer abcdefghijklmnop" } } }],
    ["GitHub credential metadata", { provenance: { metadata: { plan: "ghp_abcdefghijklmnopqrstuvwxyz123456" } } }],
    ["opaque credential metadata", { provenance: { metadata: { plan: "A".repeat(64) } } }],
    ["URL metadata", { provenance: { metadata: { displayName: "https://provider.example/quota" } } }],
    ["cookie metadata", { provenance: { metadata: { plan: "Cookie: session=secret" } } }],
    ["raw JSON metadata", { provenance: { metadata: { plan: '{"quota":1}' } } }],
    ["whitespace-prefixed JSON metadata", { provenance: { metadata: { plan: '  {"quota":1}' } } }],
    ["blank identity", { identity: { connectionId: "" } }],
    ["control characters", { identity: { accountKey: "acct\n1" } }],
    ["credential-like units", { amounts: { unit: "sk-secret-unit-123456" } }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => normalizeQuotaSnapshot(makeSnapshot(overrides))).toThrow(QuotaSnapshotValidationError);
  });

  it("rejects a non-zero ratio when the bounded limit is zero", () => {
    expect(() => normalizeQuotaSnapshot(makeSnapshot({
      amounts: { limit: 0, used: 0, remaining: 0, remainingRatio: 0.5 },
    }))).toThrow("zero remaining ratio");
  });

  it("does not echo unsupported secret-shaped field names", () => {
    const canary = "sk-secretkeycanary123456";
    const candidate = makeSnapshot({ provenance: { metadata: { [canary]: "value" } } });
    const error = (() => {
      try { normalizeQuotaSnapshot(candidate); } catch (caught) { return caught; }
      return null;
    })();
    expect(error).toBeInstanceOf(QuotaSnapshotValidationError);
    expect(error.message).toBe("provenance.metadata contains an unsupported field");
    expect(error.message).not.toContain(canary);
  });

  it("treats the exact staleAt boundary as stale", () => {
    const snapshot = makeSnapshot();
    expect(isQuotaSnapshotFresh(snapshot, "2025-12-31T23:59:59.999Z")).toBe(false);
    expect(isQuotaSnapshotFresh(snapshot, "2026-01-01T00:59:59.999Z")).toBe(true);
    expect(isQuotaSnapshotFresh(snapshot, "2026-01-01T01:00:00.000Z")).toBe(false);
  });

  it("rejects clocks outside JavaScript's timestamp range", () => {
    expect(() => canonicalizeQuotaNow(Number.MAX_SAFE_INTEGER)).toThrow(QuotaSnapshotValidationError);
  });

  it("accepts only the bounded future clock skew for observations", () => {
    const now = "2026-01-01T00:00:00.000Z";
    expect(normalizeQuotaSnapshot(makeSnapshot({
      timing: { observedAt: "2026-01-01T00:05:00.000Z", staleAt: "2026-01-01T01:05:00.000Z" },
    }), { now }).timing.observedAt).toBe("2026-01-01T00:05:00.000Z");
    expect(() => normalizeQuotaSnapshot(makeSnapshot({
      timing: { observedAt: "2026-01-01T00:05:00.001Z", staleAt: "2026-01-01T01:05:00.001Z" },
    }), { now })).toThrow("too far in the future");
  });
});

describe("quota fetch-state contract", () => {
  it("canonicalizes successful observations and defaults lastSuccessAt", () => {
    expect(normalizeQuotaFetchState({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      outcome: "success",
      attemptedAt: "2026-01-01T03:00:00+03:00",
    })).toEqual({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      outcome: "success",
      lastObservedAt: "2026-01-01T00:00:00.000Z",
      attemptedAt: "2026-01-01T00:00:00.000Z",
      retryAt: null,
      lastSuccessAt: "2026-01-01T00:00:00.000Z",
      reasonCode: null,
    });
  });

  it("keeps a sanitized failure distinct from provider state", () => {
    const failure = normalizeQuotaFetchState({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      outcome: "rate_limited",
      attemptedAt: "2026-01-01T00:00:00Z",
      retryAt: "2026-01-01T00:05:00Z",
      lastObservedAt: "2025-12-31T23:00:00Z",
      lastSuccessAt: "2025-12-31T23:00:00Z",
    });
    expect(failure).toMatchObject({ outcome: "rate_limited", reasonCode: "rate_limited" });
  });

  it.each([
    { outcome: "aborted", attemptedAt: "2026-01-01T00:00:00Z" },
    { outcome: "success", attemptedAt: "2026-01-01T00:00:00Z", reasonCode: "timeout" },
    { outcome: "timeout", attemptedAt: "2026-01-01T00:00:00Z", retryAt: "2025-12-31T23:59:59Z" },
    { outcome: "timeout", attemptedAt: "2026-01-01T00:00:00Z", lastSuccessAt: "2026-01-01T00:00:01Z" },
    { outcome: "timeout", attemptedAt: "2026-01-01T00:00:00Z", retryAt: "2026-01-02T00:00:00.001Z" },
    { outcome: "timeout", attemptedAt: "2026-01-01T00:00:00Z", lastObservedAt: "2025-12-31T23:00:00Z" },
    { outcome: "success", attemptedAt: "2026-01-01T00:00:00Z", retryAt: "2026-01-01T00:01:00Z" },
    { outcome: "timeout", attemptedAt: "2026-01-01T00:00:00Z", reasonCode: "network_error" },
  ])("rejects malformed fetch state %#", (overrides) => {
    expect(() => normalizeQuotaFetchState({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      ...overrides,
    })).toThrow(QuotaSnapshotValidationError);
  });

  it("bounds future fetch attempts independently of provider retry time", () => {
    const base = {
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      outcome: "timeout",
    };
    expect(normalizeQuotaFetchState({ ...base, attemptedAt: "2026-01-01T00:05:00.000Z" }, {
      now: "2026-01-01T00:00:00.000Z",
    }).attemptedAt).toBe("2026-01-01T00:05:00.000Z");
    expect(() => normalizeQuotaFetchState({ ...base, attemptedAt: "2026-01-01T00:05:00.001Z" }, {
      now: "2026-01-01T00:00:00.000Z",
    })).toThrow("too far in the future");
  });
});
