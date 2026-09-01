import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRateLimitEvidence, parseUpstreamError } from "../../open-sse/utils/error.js";
import {
  createProviderRateLimitEvidence,
  resetProviderAttemptClockForTests,
  allocateProviderAttemptTimestamp,
} from "../../src/shared/services/providerRateLimitEvidence.js";
import { QUOTA_MAX_CLOCK_SKEW_MS } from "../../src/shared/constants/quota.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (key) => normalized.get(String(key).toLowerCase()) ?? null };
}

describe("bounded 429 evidence parsing", () => {
  it("uses executor reset, Retry-After seconds/date, and epoch reset headers in precedence order", () => {
    expect(parseRateLimitEvidence({ status: 429, executorResetAtMs: NOW + 5_000, headers: headers({ "retry-after": "60" }), bodyText: "reset at 2026-07-10 17:00:00", now: NOW }))
      .toMatchObject({ resetAtMs: NOW + 5_000, source: "executor" });
    expect(parseRateLimitEvidence({ status: 429, headers: headers({ "retry-after": "60" }), bodyText: "reset at 2026-07-10 17:00:00", now: NOW }))
      .toMatchObject({ resetAtMs: NOW + 60_000, source: "retry_after" });
    expect(parseRateLimitEvidence({ status: 429, headers: headers({ "retry-after": new Date(NOW + 120_000).toUTCString() }), bodyText: "reset at 2026-07-10 17:00:00", now: NOW }))
      .toMatchObject({ resetAtMs: NOW + 120_000, source: "retry_after" });
    expect(parseRateLimitEvidence({ status: 429, headers: headers({ "x-ratelimit-reset": String((NOW + 180_000) / 1000) }), bodyText: "reset at 2026-07-10 17:00:00", now: NOW }))
      .toMatchObject({ resetAtMs: NOW + 180_000, source: "reset_header" });
  });

  it("parses allowlisted JSON fields and compound quota durations", () => {
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: JSON.stringify({ error: { retry_after_ms: 90_000, message: "reset at 2026-07-10 17:00:00" } }),
      now: NOW,
    })).toMatchObject({ resetAtMs: NOW + 90_000, source: "structured_body", state: "cooldown" });
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: "Your session usage quota was reached and will reset after 5 hours 2 minutes",
      now: NOW,
    })).toMatchObject({ resetAtMs: NOW + (5 * 60 + 2) * 60_000, source: "quota_text", state: "exhausted" });
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: "You have reached your weekly usage limit",
      now: NOW,
    })).toMatchObject({ resetAtMs: null, source: "local_policy", state: "exhausted" });
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: JSON.stringify({
        error: {
          type: "insufficient_quota",
          code: "insufficient_quota",
          message: "You exceeded your current quota, please check your plan and billing details.",
        },
      }),
      now: NOW,
    })).toMatchObject({ resetAtMs: null, source: "local_policy", state: "exhausted" });
  });

  it("accepts explicit retry/reset clauses for ordinary cooldowns", () => {
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: "Rate limit exceeded. Retry after 30 seconds.",
      now: NOW,
    })).toMatchObject({ resetAtMs: NOW + 30_000, source: "quota_text", state: "cooldown" });
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: "Too many requests; retry in 1 minute.",
      now: NOW,
    })).toMatchObject({ resetAtMs: NOW + 60_000, source: "quota_text", state: "cooldown" });
  });

  it("parses GLM/Z.AI bare reset timestamps as UTC", () => {
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: "Usage limit reached for 5 hour. Your limit will reset at 2026-07-10 17:00:00",
      now: NOW,
    })).toMatchObject({
      resetAtMs: Date.parse("2026-07-10T17:00:00.000Z"),
      source: "quota_text",
      state: "exhausted",
    });
  });

  it("rejects past and over-cap GLM/Z.AI reset timestamps", () => {
    for (const timestamp of ["2026-07-10 11:59:59", "2026-07-17 12:00:01"]) {
      expect(parseRateLimitEvidence({
        status: 429,
        bodyText: `Your limit will reset at ${timestamp}`,
        now: NOW,
      })).toMatchObject({ resetAtMs: null, source: "local_policy" });
    }
  });

  it("propagates a GLM/Z.AI prose reset through parseUpstreamError", async () => {
    const parsed = await parseUpstreamError(new Response(JSON.stringify({
      error: { message: "Usage limit reached. Your limit will reset at 2026-07-10 17:00:00" },
    }), { status: 429 }), null, { now: NOW });

    expect(parsed).toMatchObject({
      statusCode: 429,
      message: "Rate limit exceeded",
      resetsAtMs: Date.parse("2026-07-10T17:00:00.000Z"),
      rateLimitEvidence: {
        resetAtMs: Date.parse("2026-07-10T17:00:00.000Z"),
        source: "quota_text",
        state: "exhausted",
      },
    });
  });

  it("rejects malformed, past, negative, and over-cap hints", () => {
    for (const value of ["-1", "NaN", "999999999", new Date(NOW - 1000).toUTCString()]) {
      expect(parseRateLimitEvidence({ status: 429, headers: headers({ "retry-after": value }), now: NOW }))
        .toMatchObject({ resetAtMs: null, source: "local_policy", state: "cooldown" });
    }
  });

  it("does not resurrect an executor reset rejected by the bounded parser", async () => {
    const rawResetAtMs = NOW + MAX_RATE_LIMIT_COOLDOWN_MS + 1;
    const executor = {
      parseError: vi.fn(() => ({
        status: 429,
        message: "provider body must remain private",
        resetsAtMs: rawResetAtMs,
      })),
    };

    const parsed = await parseUpstreamError(
      new Response("rate limited", { status: 429 }),
      executor,
      { now: NOW },
    );

    expect(parsed).toMatchObject({
      statusCode: 429,
      message: "Rate limit exceeded",
      resetsAtMs: null,
      rateLimitEvidence: {
        state: "cooldown",
        resetAtMs: null,
        source: "local_policy",
      },
    });
  });

  it("parses strict duration reset headers and waits for the later request/token constraint", () => {
    expect(parseRateLimitEvidence({
      status: 429,
      headers: headers({
        "x-ratelimit-reset-requests": "1m23s",
        "x-ratelimit-reset-tokens": "2m",
      }),
      now: NOW,
    })).toMatchObject({ resetAtMs: NOW + 120_000, source: "reset_header" });
    expect(parseRateLimitEvidence({
      status: 429,
      bodyText: "Weekly quota exceeded on the 5 hour plan; retry after 1 minute",
      now: NOW,
    })).toMatchObject({ resetAtMs: NOW + 60_000, source: "quota_text" });
  });

  it("never returns or forwards the raw 429 provider body", async () => {
    const canary = "RAW_PROVIDER_BODY_CANARY access_token=super-secret";
    const parsed = await parseUpstreamError(new Response(canary, { status: 429, headers: { "Retry-After": "30" } }));
    expect(parsed.message).toBe("Rate limit exceeded");
    expect(JSON.stringify(parsed)).not.toContain("RAW_PROVIDER_BODY_CANARY");
    expect(JSON.stringify(parsed)).not.toContain("super-secret");
  });

  it("bounds stalled and oversized provider error bodies", async () => {
    const cancel = vi.fn();
    const stalled = new Response(new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel,
    }), { status: 429, headers: { "Retry-After": "30" } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(parseUpstreamError(stalled, null, { signal: controller.signal, timeoutMs: 1_000 }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();

    const oversized = new Response(new Uint8Array(70 * 1024).fill(65), { status: 429, headers: { "Retry-After": "30" } });
    await expect(parseUpstreamError(oversized, null, { maxBytes: 64 * 1024 }))
      .resolves.toMatchObject({ message: "Rate limit exceeded" });
  });
});

describe("runtime rate-limit repository writer", () => {
  beforeEach(() => resetProviderAttemptClockForTests());

  it("allocates strictly increasing attempt clocks", () => {
    expect(allocateProviderAttemptTimestamp(1000)).toBe(1000);
    expect(allocateProviderAttemptTimestamp(1000)).toBe(1001);
    expect(allocateProviderAttemptTimestamp(999)).toBe(1002);
  });

  it("caps future allocator input at the shared clock-skew boundary", () => {
    const wall = Date.now();
    const allocated = allocateProviderAttemptTimestamp(wall + QUOTA_MAX_CLOCK_SKEW_MS + 60_000);
    expect(allocated).toBeLessThanOrEqual(Date.now() + QUOTA_MAX_CLOCK_SKEW_MS);
  });

  it("persists one bounded catalog-model row and clears only the same source", async () => {
    const writes = [];
    const knownSources = new Set();
    const repository = {
      getQuotaFetchState: vi.fn(async ({ sourceId }) => knownSources.has(sourceId) ? { outcome: "success" } : null),
      replaceProviderQuotaSnapshotsForSource: vi.fn(async (value) => {
        writes.push(structuredClone(value));
        if (value.snapshots.length > 0) knownSources.add(value.sourceId);
        return { accepted: true, snapshots: value.snapshots };
      }),
    };
    const evidence = createProviderRateLimitEvidence({ repository, now: () => NOW + 10_000 });
    const record = await evidence.record({
      connectionId: "conn-1",
      provider: "codex",
      model: "gpt-5.4",
      attemptStartedAt: NOW,
      state: "cooldown",
      resetAtMs: NOW + 60_000,
    });
    const cleared = await evidence.clear({
      connectionId: "conn-1",
      provider: "codex",
      model: "gpt-5.4",
      attemptStartedAt: NOW + 1,
    });

    expect(record.persisted).toBe(true);
    expect(cleared.persisted).toBe(true);
    expect(writes).toHaveLength(3);
    expect(writes[0].snapshots).toHaveLength(1);
    expect(writes[0].snapshots[0]).toMatchObject({
      identity: {
        connectionId: "conn-1",
        provider: "codex",
        resourceKey: "model:gpt-5.4",
        dimensionKey: "requests:runtime",
      },
      state: "cooldown",
      provenance: { sourceType: "response_headers", reasonCode: "rate_limited", metadata: {} },
    });
    expect(writes.slice(1).every((write) => write.snapshots.length === 0)).toBe(true);
    expect(new Set(writes.slice(1).map((write) => write.sourceId)).size).toBe(2);
    expect(writes.slice(1).map((write) => write.sourceId)).toContain(writes[0].sourceId);
    expect(JSON.stringify(writes)).not.toMatch(/api[_-]?key|access[_-]?token|refresh[_-]?token|authorization/i);
  });

  it("fails open without durable rows for an untrusted passthrough model", async () => {
    const repository = { replaceProviderQuotaSnapshotsForSource: vi.fn() };
    const evidence = createProviderRateLimitEvidence({ repository });
    await expect(evidence.record({
      connectionId: "conn-1",
      provider: "opencode-zen",
      model: "attacker-controlled-model-123",
      attemptStartedAt: NOW,
      state: "cooldown",
      resetAtMs: NOW + 10_000,
    })).resolves.toMatchObject({ persisted: false, reason: "untrusted_scope" });
    expect(repository.replaceProviderQuotaSnapshotsForSource).not.toHaveBeenCalled();
  });

  it("persists no-reset exhaustion honestly and rejects future/over-cap evidence", async () => {
    const writes = [];
    const repository = {
      replaceProviderQuotaSnapshotsForSource: vi.fn(async (value) => {
        writes.push(structuredClone(value));
        return { accepted: true };
      }),
    };
    const evidence = createProviderRateLimitEvidence({ repository, now: () => NOW });
    await expect(evidence.record({
      connectionId: "conn-1",
      provider: "codex",
      model: "gpt-5.4",
      attemptStartedAt: NOW,
      state: "exhausted",
      resetAtMs: null,
    })).resolves.toMatchObject({ persisted: true });
    expect(writes[0].snapshots[0]).toMatchObject({
      identity: { resourceKey: "scope:account" },
      state: "exhausted",
      timing: { resetAt: null, cooldownUntil: null },
    });
    expect(Date.parse(writes[0].snapshots[0].timing.staleAt)).toBe(NOW + 60_000);

    await expect(evidence.record({
      connectionId: "conn-1", provider: "codex", model: "gpt-5.4",
      attemptStartedAt: NOW + QUOTA_MAX_CLOCK_SKEW_MS + 1,
      state: "cooldown", resetAtMs: NOW + 60_000,
    })).resolves.toMatchObject({ persisted: false });
    await expect(evidence.record({
      connectionId: "conn-1", provider: "codex", model: "gpt-5.4",
      attemptStartedAt: NOW,
      state: "cooldown", resetAtMs: NOW + MAX_RATE_LIMIT_COOLDOWN_MS + 1,
    })).resolves.toMatchObject({ persisted: false, reason: "invalid_deadline" });
  });

  it("keeps thinking-suffixed Codex review evidence on the review feature scope", async () => {
    const writes = [];
    const repository = {
      replaceProviderQuotaSnapshotsForSource: vi.fn(async (value) => {
        writes.push(structuredClone(value));
        return { accepted: true };
      }),
    };
    const evidence = createProviderRateLimitEvidence({ repository, now: () => NOW });
    await evidence.record({
      connectionId: "conn-1",
      provider: "codex",
      model: "gpt-5.4-review(high)",
      attemptStartedAt: NOW,
      state: "exhausted",
      resetAtMs: NOW + 60_000,
    });
    expect(writes[0].snapshots[0].identity.resourceKey).toBe("feature:code-review");

    await evidence.record({
      connectionId: "conn-1",
      provider: "codex",
      model: "gpt-5.4-review(high)",
      attemptStartedAt: NOW + 1,
      state: "cooldown",
      resetAtMs: NOW + 60_000,
    });
    expect(writes[1].snapshots[0].identity.resourceKey).toBe("model:gpt-5.4-review");
  });
});
