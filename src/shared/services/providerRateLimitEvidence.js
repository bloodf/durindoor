import { createHash } from "node:crypto";
import {
  PROVIDER_ID_TO_ALIAS,
  getCanonicalModelId,
  getModelQuotaFamily } from
"open-sse/config/providerModels.js";
import { getProviderQuotaConfig, PROVIDER_QUOTA_DEFAULTS } from "open-sse/config/providerQuota.js";
import { quotaScopedKey } from "open-sse/services/quota/normalize.js";
import {
  QUOTA_IDENTITY_DEFAULTS,
  QUOTA_MAX_CLOCK_SKEW_MS,
  QUOTA_MAX_FRESHNESS_MS } from
"@/shared/constants/quota";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { isFunction, isString } from "../utils/typeChecks.js";

const RUNTIME_DIMENSION = "requests:runtime";
let lastAttemptTimestamp = 0;

function abortError() {
  return new DOMException("Provider request aborted", "AbortError");
}

/**
 * Allocate a process-wide monotonic attempt clock. Ordering by attempt start,
 * rather than completion order, prevents an old slow request from erasing a
 * newer request's evidence when their callbacks finish out of order.
 */
export function allocateProviderAttemptTimestamp(now = Date.now()) {
  const wallNow = Date.now();
  const clock = Number(now);
  const candidate = Number.isFinite(clock) && clock >= 0 && clock <= wallNow + QUOTA_MAX_CLOCK_SKEW_MS ?
  Math.floor(clock) :
  wallNow;
  const cap = wallNow + QUOTA_MAX_CLOCK_SKEW_MS;
  lastAttemptTimestamp = Math.min(Math.max(candidate, lastAttemptTimestamp + 1), cap);
  return lastAttemptTimestamp;
}

export function resetProviderAttemptClockForTests() {
  lastAttemptTimestamp = 0;
}

function resolveCatalogScope(provider, model, state = "cooldown") {
  if (!isString(provider) || !provider || !isString(model) || !model) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const config = getProviderQuotaConfig(provider);
  const quotaFamily = getModelQuotaFamily(alias, model);
  const familyResource = quotaFamily ? config?.preflightScopes?.quotaFamilies?.[quotaFamily] : null;
  const canonicalModel = getCanonicalModelId(alias, model);
  if (!canonicalModel) return null;
  const accountWide = config?.runtimeScopes?.[state] === "account";
  // Durable quota exhaustion may apply to a configured family. A transient
  // cooldown remains model-scoped so one 429 cannot bench sibling models.
  const resourceKey = (state === "exhausted" ? familyResource : null) || (
  accountWide ? QUOTA_IDENTITY_DEFAULTS.resourceKey : quotaScopedKey("model", canonicalModel));
  const digest = createHash("sha256").
  update("durindoor-runtime-quota\0").
  update(provider).
  update("\0").
  update(resourceKey).
  digest("hex").
  slice(0, 24);
  return {
    canonicalModel,
    resourceKey,
    sourceId: `${provider}:runtime-rate-limit-${digest}:v1`
  };
}

async function defaultRepository() {
  const db = await import("@/lib/localDb");
  if (!isFunction(db.replaceProviderQuotaSnapshotsForSource)) return null;
  return db;
}

function iso(value) {
  return new Date(value).toISOString();
}

/** Create a bounded runtime-evidence writer with an injectable repository. */
export function createProviderRateLimitEvidence({ repository = null, now = Date.now } = {}) {
  async function replace({
    connectionId,
    provider,
    model,
    attemptStartedAt,
    snapshots,
    signal = null,
    scope: suppliedScope = null
  }) {
    if (signal?.aborted) throw abortError();
    if (!connectionId || connectionId === "noauth") return { persisted: false, reason: "no_connection" };
    const scope = suppliedScope || resolveCatalogScope(provider, model);
    // Unknown passthrough models deliberately fail open. Hashing every arbitrary
    // user-controlled model would create an unbounded durable source-ID set.
    if (!scope) return { persisted: false, reason: "untrusted_scope" };
    const observedMs = Number(attemptStartedAt);
    if (!Number.isSafeInteger(observedMs) || observedMs <= 0) {
      return { persisted: false, reason: "invalid_attempt_clock" };
    }
    const clockMs = Number(now());
    if (!Number.isFinite(clockMs) || observedMs > clockMs + QUOTA_MAX_CLOCK_SKEW_MS) {
      return { persisted: false, reason: "future_attempt_clock" };
    }
    const observedAt = iso(observedMs);
    const repo = repository || (await defaultRepository());
    if (!repo) return { persisted: false, reason: "repository_unavailable" };
    if (signal?.aborted) throw abortError();
    const result = await repo.replaceProviderQuotaSnapshotsForSource({
      connectionId,
      provider,
      sourceId: scope.sourceId,
      observedAt,
      snapshots,
      fetchState: {
        connectionId,
        provider,
        sourceId: scope.sourceId,
        outcome: "success",
        attemptedAt: observedAt
      }
    }, {
      now: clockMs,
      signal,
      returnCommitResult: true,
      allowCanonicalSentinels: true
    });
    return {
      persisted: result?.accepted === true,
      reason: result?.accepted === false ? "superseded" : "accepted",
      sourceId: scope.sourceId,
      resourceKey: scope.resourceKey
    };
  }

  async function record({
    connectionId,
    provider,
    model,
    attemptStartedAt,
    state = "cooldown",
    resetAtMs,
    signal = null
  }) {
    if (state !== "cooldown" && state !== "exhausted") {
      return { persisted: false, reason: "invalid_state" };
    }
    const scope = resolveCatalogScope(provider, model, state);
    if (!scope) return { persisted: false, reason: "untrusted_scope" };
    const observedMs = Number(attemptStartedAt);
    const deadlineMs = resetAtMs == null ? null : Number(resetAtMs);
    const clockMs = Number(now());
    if (
    !Number.isSafeInteger(observedMs) || observedMs <= 0 ||
    !Number.isFinite(clockMs) ||
    observedMs > clockMs + QUOTA_MAX_CLOCK_SKEW_MS ||
    state === "cooldown" && (!Number.isFinite(deadlineMs) || deadlineMs <= observedMs) ||
    deadlineMs !== null && (
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= observedMs ||
    deadlineMs > clockMs + MAX_RATE_LIMIT_COOLDOWN_MS))

    return { persisted: false, reason: "invalid_deadline" };
    const staleAtMs = deadlineMs === null ?
    Math.min(observedMs + QUOTA_MAX_FRESHNESS_MS, clockMs + PROVIDER_QUOTA_DEFAULTS.freshnessMs) :
    Math.min(deadlineMs, observedMs + QUOTA_MAX_FRESHNESS_MS);
    const observedAt = iso(observedMs);
    const deadline = deadlineMs === null ? null : iso(deadlineMs);
    const snapshot = {
      identity: {
        connectionId,
        provider,
        accountKey: QUOTA_IDENTITY_DEFAULTS.accountKey,
        resourceKey: scope.resourceKey,
        dimensionKey: RUNTIME_DIMENSION
      },
      state,
      amounts: {
        limitKind: "unknown",
        limit: null,
        used: null,
        remaining: null,
        remainingRatio: null,
        unit: null
      },
      timing: {
        observedAt,
        staleAt: iso(staleAtMs),
        resetAt: state === "exhausted" ? deadline : null,
        cooldownUntil: state === "cooldown" ? deadline : null
      },
      provenance: {
        sourceType: "response_headers",
        sourceId: scope.sourceId,
        reasonCode: "rate_limited",
        metadata: {}
      }
    };
    return replace({ connectionId, provider, model, attemptStartedAt, snapshots: [snapshot], signal, scope });
  }

  async function clear({ connectionId, provider, model, attemptStartedAt, signal = null }) {
    const scopes = new Map();
    for (const state of ["cooldown", "exhausted"]) {
      const scope = resolveCatalogScope(provider, model, state);
      if (scope) scopes.set(scope.sourceId, scope);
    }
    if (scopes.size === 0) return { persisted: false, reason: "untrusted_scope" };
    const results = [];
    for (const scope of scopes.values()) {
      results.push(await replace({
        connectionId,
        provider,
        model,
        attemptStartedAt,
        snapshots: [],
        signal,
        scope
      }));
    }
    return {
      persisted: results.some((result) => result.persisted),
      reason: results.some((result) => result.persisted) ? "accepted" : results[0]?.reason,
      results
    };
  }

  return { record, clear };
}

const defaultEvidence = createProviderRateLimitEvidence();

export const recordProviderRateLimitEvidence = (...args) => defaultEvidence.record(...args);
export const clearProviderRateLimitEvidence = (...args) => defaultEvidence.clear(...args);