import { describe, expect, it } from "vitest";
import {
  quotaDecisionDiagnostic,
  rankQuotaCandidates,
  scoreQuotaCandidate,
} from "../../open-sse/services/quota/scoring.js";
import { CODEX_SSE_PEEK_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";
import { QUOTA_SELECTION_DEFAULTS } from "../../open-sse/config/quotaSelection.js";

function profile(ratio, {
  reason = "available",
  tracked = true,
  freshness = "fresh",
  comparisonKey = "all-required|model:requests:session:requests",
} = {}) {
  return {
    tracked,
    freshness,
    gateMode: "all-required",
    effectiveRatio: ratio,
    comparisonKey,
    reservationAlternatives: ratio == null ? [] : [[{
      accountKey: "scope:connection",
      resourceKey: "scope:account",
      dimensionKey: "requests:session",
      requiredAmount: 1,
    }]],
    reason,
  };
}

function candidate(id, ratio, extra = {}) {
  return {
    value: id,
    id,
    stableIdentity: id,
    quotaProfile: ratio === undefined ? null : profile(ratio),
    activeCount: 0,
    health: "healthy",
    priority: 1,
    priorityRank: 0,
    ...extra,
  };
}

describe("quota selection scoring", () => {
  it("keeps the Codex prefix inspection deadline below the reservation lease", () => {
    expect(CODEX_SSE_PEEK_TIMEOUT_MS).toBeLessThan(QUOTA_SELECTION_DEFAULTS.leaseMs);
  });

  it("returns explainable 0-1000 component scores for fresh compatible quota", () => {
    const full = scoreQuotaCandidate(candidate("full", 1), { candidateCount: 2 });
    const low = scoreQuotaCandidate(candidate("low", 0.1, { activeCount: 1, health: "degraded", priorityRank: 1 }), { candidateCount: 2 });
    expect(full).toMatchObject({ score: 1000, eligible: true, comparable: true, effectiveRatio: 1 });
    expect(full.factors).toEqual({ quota: 600, pressure: 200, health: 125, priority: 75 });
    expect(low.score).toBeLessThan(full.score);
    expect(low.explanation.candidate).toMatch(/^[a-f0-9]{16}$/);
    expect(full.explanation.comparisonCohort).toMatch(/^[a-f0-9]{16}$/);
    expect(low.explanation).not.toHaveProperty("connectionId");
  });

  it("projects decision diagnostics without raw candidate or cohort identities", () => {
    const decision = scoreQuotaCandidate(candidate("conn-secret@example.test", 0.75), { candidateCount: 2 });
    const diagnostic = quotaDecisionDiagnostic(decision);
    expect(diagnostic).toMatchObject({
      score: 850,
      eligible: true,
      comparable: true,
      gateMode: "all-required",
      freshness: "fresh",
    });
    expect(diagnostic.candidate).toMatch(/^[a-f0-9]{16}$/);
    expect(diagnostic.comparisonCohort).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(diagnostic)).not.toContain("conn-secret@example.test");
    expect(quotaDecisionDiagnostic({
      reasons: ["provider payload secret"],
      explanation: { candidate: "raw-id", comparisonCohort: "raw-cohort", gateMode: "custom", freshness: "future" },
    })).toMatchObject({
      candidate: null,
      comparisonCohort: null,
      gateMode: null,
      freshness: "missing",
      reasons: ["other"],
    });
  });

  it("keeps unknown, stale, missing, and tracker errors eligible and unscored", () => {
    for (const [reason, freshness] of [["unknown", "fresh"], ["stale", "stale"], ["missing", "missing"], ["tracker_error", "fresh"]]) {
      const decision = scoreQuotaCandidate(candidate(reason, null, { quotaProfile: profile(null, { reason, tracked: false, freshness }) }));
      expect(decision).toMatchObject({ score: null, eligible: true, comparable: false });
      expect(decision.reasons).toContain(reason);
    }
  });

  it("distinguishes provider exhaustion from the optional inclusive routing floor", () => {
    expect(scoreQuotaCandidate(candidate("exhausted", 0, { quotaProfile: profile(0, { reason: "exhausted" }) })))
      .toMatchObject({ eligible: false, reasons: ["exhausted"] });
    const floor = { enabled: true, ratio: 0.02 };
    expect(scoreQuotaCandidate(candidate("below", 0.019999), { routingFloor: floor }).reasons).toContain("below_routing_floor");
    expect(scoreQuotaCandidate(candidate("equal", 0.02), { routingFloor: floor }).eligible).toBe(false);
    expect(scoreQuotaCandidate(candidate("above", 0.020001), { routingFloor: floor }).eligible).toBe(true);
    expect(scoreQuotaCandidate(candidate("disabled", 0.01), { routingFloor: { enabled: false, ratio: 0.02 } }).eligible).toBe(true);
  });

  it("reorders only comparable positions and preserves untracked candidates exactly", () => {
    const ranked = rankQuotaCandidates([
      candidate("tracked-low", 0.1),
      candidate("unknown", undefined),
      candidate("tracked-high", 0.9),
      candidate("stale", null, { quotaProfile: profile(null, { tracked: false, reason: "stale", freshness: "stale" }) }),
    ]);
    expect(ranked.map((entry) => entry.value)).toEqual(["tracked-high", "unknown", "tracked-low", "stale"]);
  });

  it("reorders only within an explicit compatible quota cohort", () => {
    const ranked = rankQuotaCandidates([
      candidate("requests-low", 0.1),
      candidate("tokens-high", 0.99, {
        quotaProfile: profile(0.99, { comparisonKey: "all-required|scope:account:tokens:session:tokens" }),
      }),
      candidate("requests-high", 0.9),
      candidate("balance-high", 1, {
        quotaProfile: profile(1, { comparisonKey: "all-required|scope:account:balance:usd:usd" }),
      }),
    ]);

    expect(ranked.map((entry) => entry.value)).toEqual([
      "requests-high",
      "tokens-high",
      "requests-low",
      "balance-high",
    ]);
  });

  it("uses pressure, priority, recency, original order, and hashed identity as stable ties", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const ranked = rankQuotaCandidates([
      candidate("busy", 0.5, { activeCount: 2, priority: 1, priorityRank: 0, lastSelectedAt: new Date(now - 1_000).toISOString() }),
      candidate("idle", 0.5, { activeCount: 0, priority: 2, priorityRank: 1, lastSelectedAt: new Date(now - 1_000).toISOString() }),
    ], { now });
    expect(ranked.map((entry) => entry.value)).toEqual(["idle", "busy"]);
    expect(rankQuotaCandidates([candidate("a", 0.5), candidate("b", 0.5)], { now }).map((entry) => entry.value)).toEqual(["a", "b"]);
  });

  it("activates a deterministic persisted starvation tier after five minutes", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const ranked = rankQuotaCandidates([
      candidate("recent-full", 1, { lastSelectedAt: new Date(now - 60_000).toISOString() }),
      candidate("starved-low", 0.2, { lastSelectedAt: new Date(now - 6 * 60_000).toISOString() }),
    ], { now });
    expect(ranked.map((entry) => entry.value)).toEqual(["starved-low", "recent-full"]);
  });
});
