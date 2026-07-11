import { createHash } from "node:crypto";
import { QUOTA_SELECTION_DEFAULTS } from "../../config/quotaSelection.js";

const HEALTH_FACTORS = Object.freeze({ healthy: 1, closed: 1, degraded: 0.5, "half-open": 0.5, unhealthy: 0, open: 0 });
const DIAGNOSTIC_REASONS = new Set([
  "available", "low", "exhausted", "cooldown", "below_routing_floor",
  "inflight_pressure", "starvation_tier", "untracked", "unknown", "stale",
  "missing", "tracker_error", "fetch_error", "unsupported", "non_applicable",
  "foreign_source", "malformed", "legacy_lock",
]);
const DIAGNOSTIC_GATE_MODES = new Set(["all-required", "any-sufficient", "first-present"]);
const DIAGNOSTIC_FRESHNESS = new Set(["fresh", "stale", "missing"]);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function stableHash(value) {
  return createHash("sha256").update(String(value || "quota-candidate")).digest("hex").slice(0, 16);
}

function priorityFactor(rank, count) {
  if (count <= 1) return 1;
  const bounded = Math.max(0, Math.min(count - 1, Number(rank) || 0));
  return 1 - bounded / (count - 1);
}

/**
 * Pure, explainable quota score. Absolute values are never compared across
 * units; callers provide one already-normalized compatible quota profile.
 */
export function scoreQuotaCandidate(candidate, {
  now = Date.now(),
  routingFloor = { enabled: false, ratio: QUOTA_SELECTION_DEFAULTS.routingFloorRatio },
  candidateCount = 1,
} = {}) {
  const profile = candidate?.quotaProfile || null;
  const label = stableHash(candidate?.stableIdentity || candidate?.id || candidate?.originalIndex);
  const activeCount = Math.max(0, Number(candidate?.activeCount) || 0);
  const ratio = typeof profile?.effectiveRatio === "number" && Number.isFinite(profile.effectiveRatio)
    ? clamp01(profile.effectiveRatio)
    : null;
  const comparisonKey = typeof profile?.comparisonKey === "string" && profile.comparisonKey.length > 0
    ? profile.comparisonKey
    : null;
  const comparable = profile?.tracked === true
    && profile?.freshness === "fresh"
    && ratio !== null
    && comparisonKey !== null;
  const upstreamBlocked = profile?.reason === "exhausted" || profile?.reason === "cooldown";
  const localBlockedReason = candidate?.hardBlockedReason === "legacy_lock" ? "legacy_lock" : null;
  const belowFloor = comparable
    && (candidate?.routingFloorBlocked === true
      || (routingFloor?.enabled === true
        && ratio <= routingFloor.ratio + QUOTA_SELECTION_DEFAULTS.routingFloorEpsilon));
  if (!comparable) {
    return {
      score: null,
      eligible: !upstreamBlocked && !localBlockedReason,
      comparable: false,
      comparisonKey: null,
      reasons: [localBlockedReason || profile?.reason || "untracked"],
      factors: { quota: null, pressure: null, health: null, priority: null },
      tieKey: { originalIndex: candidate?.originalIndex ?? 0, stableIdentityHash: label },
      reservationPlan: profile?.reservationAlternatives || [],
      explanation: {
        candidate: label,
        freshness: profile?.freshness || "missing",
        gateMode: profile?.gateMode || null,
        comparisonCohort: null,
      },
    };
  }

  const healthFactor = HEALTH_FACTORS[candidate?.health] ?? 1;
  const pressureFactor = 1 / (1 + activeCount);
  const priority = priorityFactor(candidate?.priorityRank, candidateCount);
  const factors = {
    quota: Math.round(ratio * 600),
    pressure: Math.round(pressureFactor * 200),
    health: Math.round(healthFactor * 125),
    priority: Math.round(priority * 75),
  };
  const score = factors.quota + factors.pressure + factors.health + factors.priority;
  const lastSelectedMs = Date.parse(candidate?.lastSelectedAt || "");
  const cold = !Number.isFinite(lastSelectedMs);
  const starvationAgeMs = cold ? Number.POSITIVE_INFINITY : Math.max(0, Number(now) - lastSelectedMs);
  const starved = !upstreamBlocked
    && !belowFloor
    && activeCount === 0
    && starvationAgeMs >= QUOTA_SELECTION_DEFAULTS.starvationMs;
  const reasons = [];
  if (localBlockedReason) reasons.push(localBlockedReason);
  if (upstreamBlocked) reasons.push(profile.reason);
  if (belowFloor) reasons.push("below_routing_floor");
  if (profile.reason === "low") reasons.push("low");
  if (activeCount > 0) reasons.push("inflight_pressure");
  if (starved) reasons.push("starvation_tier");
  if (reasons.length === 0) reasons.push("available");
  return {
    score,
    eligible: !localBlockedReason && !upstreamBlocked && !belowFloor,
    comparable: true,
    comparisonKey,
    reasons,
    factors,
    effectiveRatio: ratio,
    activeCount,
    starved,
    starvationAgeMs,
    tieKey: {
      priority: Number.isFinite(Number(candidate?.priority))
        ? Number(candidate.priority)
        : Number.MAX_SAFE_INTEGER,
      lastSelectedAt: candidate?.lastSelectedAt || null,
      originalIndex: candidate?.originalIndex ?? 0,
      stableIdentityHash: label,
    },
    reservationPlan: profile.reservationAlternatives || [],
    explanation: {
      candidate: label,
      freshness: profile.freshness,
      gateMode: profile.gateMode,
      comparisonCohort: stableHash(comparisonKey),
      reasonCodes: reasons,
      cutoff: belowFloor ? { code: "below_routing_floor", ratio: routingFloor.ratio } : null,
    },
  };
}

/** Redacted, fixed-shape debug payload safe for account/combo decision logs. */
export function quotaDecisionDiagnostic(decision) {
  const explanation = decision?.explanation || {};
  const factors = decision?.factors || {};
  const reasonCodes = (decision?.reasons || []).map((reason) => (
    DIAGNOSTIC_REASONS.has(reason) ? reason : "other"
  ));
  return {
    candidate: /^[a-f0-9]{16}$/.test(explanation.candidate || "")
      ? explanation.candidate
      : null,
    score: Number.isFinite(decision?.score) ? decision.score : null,
    factors: {
      quota: Number.isFinite(factors.quota) ? factors.quota : null,
      pressure: Number.isFinite(factors.pressure) ? factors.pressure : null,
      health: Number.isFinite(factors.health) ? factors.health : null,
      priority: Number.isFinite(factors.priority) ? factors.priority : null,
    },
    reasons: [...new Set(reasonCodes)],
    eligible: decision?.eligible === true,
    comparable: decision?.comparable === true,
    gateMode: DIAGNOSTIC_GATE_MODES.has(explanation.gateMode) ? explanation.gateMode : null,
    freshness: DIAGNOSTIC_FRESHNESS.has(explanation.freshness) ? explanation.freshness : "missing",
    comparisonCohort: /^[a-f0-9]{16}$/.test(explanation.comparisonCohort || "")
      ? explanation.comparisonCohort
      : null,
  };
}

function compareScored(left, right) {
  if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
  if (left.starved !== right.starved) return left.starved ? -1 : 1;
  if (left.starved && right.starved && left.starvationAgeMs !== right.starvationAgeMs) {
    return right.starvationAgeMs - left.starvationAgeMs;
  }
  return right.score - left.score
    || left.tieKey.priority - right.tieKey.priority
    || left.activeCount - right.activeCount
    || left.tieKey.originalIndex - right.tieKey.originalIndex
    || left.tieKey.stableIdentityHash.localeCompare(right.tieKey.stableIdentityHash);
}

/** Reorder only comparable slots; unknown/stale/error candidates stay put. */
export function rankQuotaCandidates(candidates, options = {}) {
  const scored = (candidates || []).map((candidate, originalIndex) => ({
    candidate,
    decision: scoreQuotaCandidate({ ...candidate, originalIndex }, {
      ...options,
      routingFloor: candidate?.routingFloor || options.routingFloor,
      candidateCount: candidates.length,
    }),
    originalIndex,
  }));
  const cohorts = new Map();
  for (const entry of scored) {
    if (!entry.decision.comparable) continue;
    const cohort = cohorts.get(entry.decision.comparisonKey) || [];
    cohort.push(entry);
    cohorts.set(entry.decision.comparisonKey, cohort);
  }
  for (const cohort of cohorts.values()) cohort.sort((a, b) => compareScored(a.decision, b.decision));
  if (cohorts.size === 0) return scored.map((entry) => ({ ...entry.candidate, quotaDecision: entry.decision }));
  const cursors = new Map();
  return scored.map((entry) => {
    if (!entry.decision.comparable) return { ...entry.candidate, quotaDecision: entry.decision };
    const key = entry.decision.comparisonKey;
    const cursor = cursors.get(key) || 0;
    const selected = cohorts.get(key)[cursor];
    cursors.set(key, cursor + 1);
    return { ...selected.candidate, quotaDecision: selected.decision };
  });
}
