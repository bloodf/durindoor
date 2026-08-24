import {
  QUOTA_FETCH_OUTCOMES,
  QUOTA_IDENTITY_DEFAULTS,
  QUOTA_LIMIT_KINDS,
  QUOTA_MAX_CLOCK_SKEW_MS,
  QUOTA_MAX_FRESHNESS_MS,
  QUOTA_MAX_RETRY_DELAY_MS,
  QUOTA_METADATA_KEYS,
  QUOTA_REASON_CODES,
  QUOTA_SOURCE_TYPES,
  QUOTA_STATES } from
"../constants/quota.js";
import { parseAbsoluteTimestamp } from "./absoluteTimestamp.js";
import { isBoolean, isNumber, isObject, isString } from "./typeChecks.js";

const IDENTIFIER_MAX_LENGTH = 256;
const TEXT_MAX_LENGTH = 128;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+:/-]*$/;
const NAMESPACED_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,31}:[A-Za-z0-9][A-Za-z0-9._~+:/-]*$/;
const UNIT_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{0,63}$/;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[A-Za-z0-9._~+/-]{8,}|sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{16,}|ya29\.[A-Za-z0-9._-]{12,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization)\s*[:=])/i;
const RAW_VALUE_PATTERN = /(?:^[\[{]|[a-z][a-z0-9+.-]*:\/\/|(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|session|sessionid|access[_-]?token|refresh[_-]?token|api[_-]?key)\s*[:=])/i;
const EMAIL_VALUE_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SENSITIVE_NAMESPACE_PATTERN = /^(?:auth|authorization|bearer|cookie|credential|key|oauth|password|proxy-authorization|secret|session|token|access[_-]?token|refresh[_-]?token|api[_-]?key|https?|wss?|data|file)$/i;
const SENSITIVE_PAYLOAD_PREFIX = /^(?:auth|authorization|bearer|cookie|credential|key|oauth|password|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key)[._:/-]/i;
const SNAPSHOT_KEYS = new Set(["identity", "state", "amounts", "timing", "provenance"]);
const IDENTITY_KEYS = new Set(["connectionId", "provider", "accountKey", "resourceKey", "dimensionKey"]);
const AMOUNT_KEYS = new Set(["limitKind", "limit", "used", "remaining", "remainingRatio", "unit"]);
const TIMING_KEYS = new Set(["observedAt", "staleAt", "resetAt", "cooldownUntil"]);
const PROVENANCE_KEYS = new Set(["sourceType", "sourceId", "reasonCode", "metadata"]);
const FETCH_STATE_KEYS = new Set(["connectionId", "provider", "sourceId", "outcome", "lastObservedAt", "attemptedAt", "retryAt", "lastSuccessAt", "reasonCode"]);
const CANONICAL_SENTINELS = new Set(Object.values(QUOTA_IDENTITY_DEFAULTS));

export class QuotaSnapshotValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuotaSnapshotValidationError";
    this.code = "INVALID_QUOTA_SNAPSHOT";
  }
}

function invalid(message) {
  throw new QuotaSnapshotValidationError(message);
}

function isPlainObject(value) {
  if (!value || !isObject(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) invalid(`${label} must be an object`);
  return value;
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label} contains an unsupported field`);
  }
}

function looksSecretOrRaw(value) {
  const candidate = value.trim();
  const opaqueLongValue = candidate.length >= 48 && /^[A-Za-z0-9._~+/-]+$/.test(candidate);
  return SECRET_VALUE_PATTERN.test(candidate) ||
  RAW_VALUE_PATTERN.test(candidate) ||
  EMAIL_VALUE_PATTERN.test(candidate) ||
  SENSITIVE_PAYLOAD_PREFIX.test(candidate) ||
  opaqueLongValue;
}

export function normalizeQuotaIdentifier(value, label = "quota identifier", {
  fallback,
  requireNamespace = false,
  allowCanonicalSentinels = false,
  allowedNestedSegments = []
} = {}) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    invalid(`${label} is required`);
  }
  if (!isString(value) || value.length === 0 || value.length > IDENTIFIER_MAX_LENGTH || value.trim() !== value) {
    invalid(`${label} must be a bounded non-secret ASCII identifier`);
  }
  if (CANONICAL_SENTINELS.has(value)) {
    if (allowCanonicalSentinels) return value;
    invalid(`${label} uses a reserved quota scope identifier`);
  }
  if (value.toLowerCase().startsWith("scope:")) invalid(`${label} uses the reserved quota scope namespace`);
  if (!IDENTIFIER_PATTERN.test(value)) invalid(`${label} must be a bounded non-secret ASCII identifier`);
  if (requireNamespace && !NAMESPACED_IDENTIFIER_PATTERN.test(value)) {
    invalid(`${label} must use a non-secret namespace:value identifier`);
  }
  const colonIndex = value.indexOf(":");
  const namespace = value.slice(0, colonIndex < 0 ? value.length : colonIndex);
  if (SENSITIVE_NAMESPACE_PATTERN.test(namespace)) {
    invalid(`${label} must not use a credential or transport namespace`);
  }
  const payload = colonIndex < 0 ? value : value.slice(colonIndex + 1);
  const allowedSegments = new Set(allowedNestedSegments.map((segment) => segment.toLowerCase()));
  const hasSensitiveSegment = value.
  split(":").
  some((segment, index) =>
  (index === 0 || !allowedSegments.has(segment.toLowerCase())) && SENSITIVE_NAMESPACE_PATTERN.test(segment) ||
  looksSecretOrRaw(segment));
  if (hasSensitiveSegment || looksSecretOrRaw(value) || payload !== value && looksSecretOrRaw(payload)) {
    invalid(`${label} must not contain credentials, URLs, email addresses, headers, or raw provider data`);
  }
  return value;
}

export function normalizeQuotaSourceId(value, provider, label = "quota source id") {
  const normalizedProvider = normalizeQuotaIdentifier(provider, `${label} provider`);
  const normalized = normalizeQuotaIdentifier(value, label, { requireNamespace: true });
  const namespace = normalized.slice(0, normalized.indexOf(":")).toLowerCase();
  if (namespace !== normalizedProvider.toLowerCase() && namespace !== "import" && namespace !== "test") {
    invalid(`${label} must use the provider, import, or test namespace`);
  }
  return normalized;
}

function normalizeOptionalNumber(value, label) {
  if (value === undefined || value === null) return null;
  if (!isNumber(value) || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    invalid(`${label} must be a finite non-negative number no greater than Number.MAX_SAFE_INTEGER`);
  }
  return value;
}

function normalizeRatio(value) {
  const ratio = normalizeOptionalNumber(value, "amounts.remainingRatio");
  if (ratio !== null && ratio > 1) invalid("amounts.remainingRatio must be between 0 and 1");
  return ratio;
}

function normalizeUnit(value) {
  if (value === undefined || value === null) return null;
  if (!isString(value) || !UNIT_PATTERN.test(value) || looksSecretOrRaw(value)) {
    invalid("amounts.unit must be a short ASCII unit identifier or null");
  }
  return value;
}

function normalizeTimestamp(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  const timestamp = parseAbsoluteTimestamp(value);
  if (timestamp === null) invalid(`${label} must be an absolute ISO-8601 timestamp with a timezone`);
  return { value: new Date(timestamp).toISOString(), timestamp };
}

function normalizeClock(value = Date.now()) {
  const timestamp = value instanceof Date ?
  value.getTime() :
  isNumber(value) ?
  value :
  parseAbsoluteTimestamp(value);
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || !Number.isFinite(date.getTime())) invalid("now must be a finite in-range epoch value, Date, or absolute timestamp");
  return { timestamp, value: date.toISOString() };
}

function normalizeFutureBound(now, maxFutureSkewMs) {
  const clock = normalizeClock(now);
  if (!Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    invalid("maxFutureSkewMs must be a non-negative safe integer");
  }
  return Math.min(8_640_000_000_000_000, clock.timestamp + maxFutureSkewMs);
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  const metadata = requireObject(value, "provenance.metadata");
  const allowed = new Set(QUOTA_METADATA_KEYS);
  rejectUnknownKeys(metadata, allowed, "provenance.metadata");
  const normalized = {};
  for (const [key, item] of Object.entries(metadata)) {
    if (key === "recurring") {
      if (!isBoolean(item)) invalid("provenance.metadata.recurring must be a boolean");
      normalized[key] = item;
      continue;
    }
    if (key === "windowSeconds") {
      if (!Number.isSafeInteger(item) || item < 0) invalid("provenance.metadata.windowSeconds must be a non-negative safe integer");
      normalized[key] = item;
      continue;
    }
    if (!isString(item) || item.length === 0 || item.length > TEXT_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(item)) {
      invalid(`provenance.metadata.${key} must be a bounded non-empty string`);
    }
    if (looksSecretOrRaw(item)) {
      invalid(`provenance.metadata.${key} looks credential-bearing or raw`);
    }
    normalized[key] = item;
  }
  return normalized;
}

export function normalizeQuotaIdentity(value, { allowCanonicalSentinels = false } = {}) {
  const identity = requireObject(value, "identity");
  rejectUnknownKeys(identity, IDENTITY_KEYS, "identity");
  return {
    connectionId: normalizeQuotaIdentifier(identity.connectionId, "identity.connectionId"),
    provider: normalizeQuotaIdentifier(identity.provider, "identity.provider"),
    accountKey: normalizeQuotaIdentifier(identity.accountKey, "identity.accountKey", {
      fallback: QUOTA_IDENTITY_DEFAULTS.accountKey,
      requireNamespace: true,
      allowCanonicalSentinels
    }),
    resourceKey: normalizeQuotaIdentifier(identity.resourceKey, "identity.resourceKey", {
      fallback: QUOTA_IDENTITY_DEFAULTS.resourceKey,
      requireNamespace: true,
      allowCanonicalSentinels
    }),
    // `requests:session` is a quota window name, not credential/session material.
    dimensionKey: normalizeQuotaIdentifier(identity.dimensionKey, "identity.dimensionKey", {
      requireNamespace: true,
      allowedNestedSegments: ["session"]
    })
  };
}

export function quotaIdentityKey(identity) {
  const normalized = normalizeQuotaIdentity(identity, { allowCanonicalSentinels: true });
  return JSON.stringify([
  normalized.connectionId,
  normalized.provider,
  normalized.accountKey,
  normalized.resourceKey,
  normalized.dimensionKey]
  );
}

/** Strict, side-effect-free normalization for one provider-reported quota row. */
export function normalizeQuotaSnapshot(value, {
  allowCanonicalSentinels = false,
  now,
  maxFutureSkewMs = QUOTA_MAX_CLOCK_SKEW_MS
} = {}) {
  const snapshot = requireObject(value, "quota snapshot");
  rejectUnknownKeys(snapshot, SNAPSHOT_KEYS, "quota snapshot");
  const identity = normalizeQuotaIdentity(snapshot.identity, { allowCanonicalSentinels });

  if (!QUOTA_STATES.includes(snapshot.state)) invalid(`state must be one of: ${QUOTA_STATES.join(", ")}`);

  const amounts = requireObject(snapshot.amounts, "amounts");
  rejectUnknownKeys(amounts, AMOUNT_KEYS, "amounts");
  if (!QUOTA_LIMIT_KINDS.includes(amounts.limitKind)) invalid(`amounts.limitKind must be one of: ${QUOTA_LIMIT_KINDS.join(", ")}`);
  const limit = normalizeOptionalNumber(amounts.limit, "amounts.limit");
  const used = normalizeOptionalNumber(amounts.used, "amounts.used");
  const remaining = normalizeOptionalNumber(amounts.remaining, "amounts.remaining");
  const remainingRatio = normalizeRatio(amounts.remainingRatio);
  const unit = normalizeUnit(amounts.unit);

  if (amounts.limitKind === "bounded" && limit === null) invalid("amounts.limit is required when limitKind is bounded");
  if (amounts.limitKind !== "bounded" && limit !== null) invalid("amounts.limit must be null unless limitKind is bounded");
  if (amounts.limitKind === "unlimited" && (remaining !== null || remainingRatio !== null)) {
    invalid("unlimited quota cannot report finite remaining amounts");
  }
  if (limit !== null && remaining !== null && remaining > limit) invalid("amounts.remaining cannot exceed amounts.limit");

  const tolerance = Math.max(1e-9, (limit ?? 0) * 1e-9);
  if (limit !== null && used !== null && remaining !== null) {
    const expected = Math.max(limit - used, 0);
    if (Math.abs(expected - remaining) > tolerance) invalid("amounts.limit, used, and remaining are inconsistent");
  }
  if (limit !== null && remainingRatio !== null) {
    if (limit === 0 && remainingRatio !== 0) invalid("zero quota limit requires a zero remaining ratio");
    if (limit > 0) {
      const absoluteRemaining = remaining ?? (used === null ? null : Math.max(limit - used, 0));
      if (absoluteRemaining !== null && Math.abs(absoluteRemaining / limit - remainingRatio) > 1e-9) {
        invalid("amounts.remainingRatio is inconsistent with the bounded quota amounts");
      }
    }
  }

  const timing = requireObject(snapshot.timing, "timing");
  rejectUnknownKeys(timing, TIMING_KEYS, "timing");
  const observed = normalizeTimestamp(timing.observedAt, "timing.observedAt");
  const stale = normalizeTimestamp(timing.staleAt, "timing.staleAt");
  const reset = normalizeTimestamp(timing.resetAt, "timing.resetAt", { optional: true });
  const cooldown = normalizeTimestamp(timing.cooldownUntil, "timing.cooldownUntil", { optional: true });
  if (stale.timestamp < observed.timestamp) invalid("timing.staleAt must not precede timing.observedAt");
  if (now !== undefined && observed.timestamp > normalizeFutureBound(now, maxFutureSkewMs)) {
    invalid("timing.observedAt is too far in the future");
  }
  if (stale.timestamp - observed.timestamp > QUOTA_MAX_FRESHNESS_MS) invalid("timing freshness window must not exceed 24 hours");
  if (reset && reset.timestamp < observed.timestamp) invalid("timing.resetAt must not precede timing.observedAt");
  if (cooldown && cooldown.timestamp < observed.timestamp) invalid("timing.cooldownUntil must not precede timing.observedAt");
  if (snapshot.state === "cooldown" && !cooldown) invalid("cooldown state requires timing.cooldownUntil");
  const effectiveStaleAt = Math.min(stale.timestamp, reset?.timestamp ?? Infinity, cooldown?.timestamp ?? Infinity);

  const provenance = requireObject(snapshot.provenance, "provenance");
  rejectUnknownKeys(provenance, PROVENANCE_KEYS, "provenance");
  if (!QUOTA_SOURCE_TYPES.includes(provenance.sourceType)) invalid(`provenance.sourceType must be one of: ${QUOTA_SOURCE_TYPES.join(", ")}`);
  const sourceId = normalizeQuotaSourceId(provenance.sourceId, identity.provider, "provenance.sourceId");
  const reasonCode = provenance.reasonCode ?? null;
  if (reasonCode !== null && !QUOTA_REASON_CODES.includes(reasonCode)) invalid(`provenance.reasonCode must be one of: ${QUOTA_REASON_CODES.join(", ")}`);

  return {
    identity,
    state: snapshot.state,
    amounts: { limitKind: amounts.limitKind, limit, used, remaining, remainingRatio, unit },
    timing: {
      observedAt: observed.value,
      staleAt: new Date(effectiveStaleAt).toISOString(),
      resetAt: reset?.value ?? null,
      cooldownUntil: cooldown?.value ?? null
    },
    provenance: {
      sourceType: provenance.sourceType,
      sourceId,
      reasonCode,
      metadata: normalizeMetadata(provenance.metadata)
    }
  };
}

export function normalizeQuotaFetchState(value, {
  now,
  maxFutureSkewMs = QUOTA_MAX_CLOCK_SKEW_MS
} = {}) {
  const state = requireObject(value, "quota fetch state");
  rejectUnknownKeys(state, FETCH_STATE_KEYS, "quota fetch state");
  const connectionId = normalizeQuotaIdentifier(state.connectionId, "quota fetch state.connectionId");
  const provider = normalizeQuotaIdentifier(state.provider, "quota fetch state.provider");
  const sourceId = normalizeQuotaSourceId(state.sourceId, provider, "quota fetch state.sourceId");
  if (!QUOTA_FETCH_OUTCOMES.includes(state.outcome)) invalid(`quota fetch state.outcome must be one of: ${QUOTA_FETCH_OUTCOMES.join(", ")}`);
  const attempted = normalizeTimestamp(state.attemptedAt, "quota fetch state.attemptedAt");
  const lastObserved = normalizeTimestamp(state.lastObservedAt, "quota fetch state.lastObservedAt", { optional: true });
  const retry = normalizeTimestamp(state.retryAt, "quota fetch state.retryAt", { optional: true });
  let lastSuccess = normalizeTimestamp(state.lastSuccessAt, "quota fetch state.lastSuccessAt", { optional: true });
  if (now !== undefined && attempted.timestamp > normalizeFutureBound(now, maxFutureSkewMs)) {
    invalid("quota fetch state.attemptedAt is too far in the future");
  }
  if (state.outcome === "success") {
    if (lastSuccess && lastSuccess.timestamp !== attempted.timestamp) {
      invalid("successful quota fetch state lastSuccessAt must equal attemptedAt");
    }
    lastSuccess = attempted;
  }
  const effectiveLastObserved = lastObserved ?? (state.outcome === "success" ? attempted : null);
  if (effectiveLastObserved && effectiveLastObserved.timestamp > attempted.timestamp) {
    invalid("quota fetch state.lastObservedAt must not follow attemptedAt");
  }
  if (now !== undefined && effectiveLastObserved && effectiveLastObserved.timestamp > normalizeFutureBound(now, maxFutureSkewMs)) {
    invalid("quota fetch state.lastObservedAt is too far in the future");
  }
  if (retry && retry.timestamp < attempted.timestamp) invalid("quota fetch state.retryAt must not precede attemptedAt");
  if (retry && retry.timestamp - attempted.timestamp > QUOTA_MAX_RETRY_DELAY_MS) {
    invalid("quota fetch state.retryAt must not be more than 24 hours after attemptedAt");
  }
  if (lastSuccess && lastSuccess.timestamp > attempted.timestamp) invalid("quota fetch state.lastSuccessAt must not follow attemptedAt");
  if (effectiveLastObserved === null !== (lastSuccess === null)) {
    invalid("quota fetch state success history must include both lastObservedAt and lastSuccessAt");
  }
  if (effectiveLastObserved && lastSuccess && effectiveLastObserved.timestamp > lastSuccess.timestamp) {
    invalid("quota fetch state.lastObservedAt must not follow lastSuccessAt");
  }
  const reasonCode = state.reasonCode ?? (state.outcome === "success" ? null : state.outcome);
  if (reasonCode !== null && !QUOTA_REASON_CODES.includes(reasonCode)) invalid(`quota fetch state.reasonCode must be one of: ${QUOTA_REASON_CODES.join(", ")}`);
  if (state.outcome === "success" && reasonCode !== null) invalid("successful quota fetch state cannot include a failure reason");
  if (state.outcome === "success" && retry !== null) invalid("successful quota fetch state cannot include retryAt");
  if (state.outcome !== "success" && reasonCode !== state.outcome) {
    invalid("failed quota fetch state reasonCode must match outcome");
  }
  return {
    connectionId,
    provider,
    sourceId,
    outcome: state.outcome,
    lastObservedAt: effectiveLastObserved?.value ?? null,
    attemptedAt: attempted.value,
    retryAt: retry?.value ?? null,
    lastSuccessAt: lastSuccess?.value ?? null,
    reasonCode
  };
}

export function canonicalizeQuotaNow(value = Date.now()) {
  return normalizeClock(value);
}

export function isQuotaSnapshotFresh(snapshot, now = Date.now()) {
  const clock = normalizeClock(now);
  const normalized = normalizeQuotaSnapshot(snapshot, { allowCanonicalSentinels: true });
  return parseAbsoluteTimestamp(normalized.timing.observedAt) <= clock.timestamp &&
  parseAbsoluteTimestamp(normalized.timing.staleAt) > clock.timestamp;
}