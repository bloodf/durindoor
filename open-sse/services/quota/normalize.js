import { createHash } from "node:crypto";
import { normalizeQuotaIdentifier } from "../../../src/shared/utils/quotaSnapshot.js";
import { isBoolean, isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";

const METADATA_TEXT_MAX = 128;
const UNSAFE_TEXT = /(?:[\u0000-\u001f\u007f]|[a-z][a-z0-9+.-]*:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|bearer\s+|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|secret)/i;

export function asRecord(value) {
  return value && isObject(value) && !Array.isArray(value) ? value : null;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function finiteQuotaNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (isString(value) && value.trim()) value = Number(value);
  if (!isNumber(value) || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

export function quotaRatio(value) {
  const number = finiteQuotaNumber(value, { min: 0, max: 1 });
  // Provider percentages routinely arrive as decimal fractions that expose
  // binary floating-point noise after subtraction (for example, 1 - 0.9).
  // Canonicalize ratios before they become persisted quota observations.
  return number === null ? null : Math.round(number * 1e12) / 1e12;
}

export function quotaPercent(value) {
  const number = finiteQuotaNumber(value, { min: 0, max: 100 });
  return number === null ? null : number / 100;
}

export function parseQuotaTimestamp(value, { now = Date.now(), relativeMs = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  let timestamp;
  if (relativeMs) {
    const duration = finiteQuotaNumber(value);
    if (duration === null) return null;
    timestamp = now + duration;
  } else if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (isNumber(value)) {
    timestamp = value < 1e12 ? value * 1000 : value;
  } else if (isString(value) && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value);
    timestamp = numeric < 1e12 ? numeric * 1000 : numeric;
  } else if (isString(value)) {
    timestamp = new Date(value).getTime();
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function hashedKey(namespace, raw) {
  const digest = createHash("sha256").
  update(namespace).
  update("\0").
  update(String(raw)).
  digest("hex").
  slice(0, 32);
  return `${namespace}:h-${digest}`;
}

/** Preserve safe public model/window names; hash private or unsafe values. */
export function quotaScopedKey(namespace, raw, { privateValue = false, fallback = "unknown" } = {}) {
  const value = String(raw ?? "").trim() || fallback;
  if (!privateValue) {
    const candidate = `${namespace}:${value}`;
    try {
      return normalizeQuotaIdentifier(candidate, "provider quota key", {
        requireNamespace: true,
        // The Batch-1 quota contract explicitly reserves this otherwise
        // security-sensitive word as a public quota-window dimension.
        allowedNestedSegments: ["requests", "tokens"].includes(namespace) ? ["session"] : []
      });
    } catch {

      // Hash below; provider values are never reflected in validation errors.
    }}
  return hashedKey(namespace, value);
}

function safeMetadataText(value) {
  if (!isString(value)) return null;
  const text = value.trim();
  if (!text || text.length > METADATA_TEXT_MAX || UNSAFE_TEXT.test(text)) return null;
  const opaque = text.length >= 48 && /^[A-Za-z0-9._~+/-]+$/.test(text);
  return opaque ? null : text;
}

export function quotaMetadata({ displayName, plan, recurring, windowSeconds } = {}) {
  const metadata = {};
  const safeDisplayName = safeMetadataText(displayName);
  const safePlan = safeMetadataText(plan);
  if (safeDisplayName) metadata.displayName = safeDisplayName;
  if (safePlan) metadata.plan = safePlan;
  if (isBoolean(recurring)) metadata.recurring = recurring;
  if (Number.isSafeInteger(windowSeconds) && windowSeconds >= 0) metadata.windowSeconds = windowSeconds;
  return metadata;
}

function deriveState({ exhausted, cooldownUntil, remaining, remainingRatio, limit }) {
  if (cooldownUntil) return "cooldown";
  if (exhausted === true) return "exhausted";
  if (remainingRatio !== null) {
    if (remainingRatio === 0) return "exhausted";
    return remainingRatio <= 0.1 ? "low" : "available";
  }
  if (remaining !== null) {
    if (remaining === 0) return "exhausted";
    if (limit !== null && limit > 0 && remaining / limit <= 0.1) return "low";
    return "available";
  }
  return "unknown";
}

/**
 * Build one strict row descriptor. The tracker adds connection/provider,
 * observation timing, provenance, and performs Batch-1 normalization.
 */
export function quotaRow({
  accountKey = null,
  resourceKey = null,
  dimensionKey,
  limitKind = "unknown",
  limit = null,
  used = null,
  remaining = null,
  remainingRatio = null,
  unit = null,
  resetAt = null,
  cooldownUntil = null,
  exhausted = false,
  metadata = {}
} = {}) {
  if (!isString(dimensionKey) || !dimensionKey) return null;
  if (!new Set(["bounded", "unlimited", "unknown"]).has(limitKind)) return null;

  limit = limit === null ? null : finiteQuotaNumber(limit);
  used = used === null ? null : finiteQuotaNumber(used);
  remaining = remaining === null ? null : finiteQuotaNumber(remaining);
  remainingRatio = remainingRatio === null ? null : quotaRatio(remainingRatio);
  if (limitKind === "bounded" && limit === null) return null;
  if (limitKind !== "bounded" && limit !== null) return null;
  if (limitKind === "unlimited" && (remaining !== null || remainingRatio !== null)) return null;

  if (limit !== null) {
    if (remaining !== null && remaining > limit) return null;
    if (used !== null && remaining !== null && Math.abs(Math.max(limit - used, 0) - remaining) > Math.max(1e-9, limit * 1e-9)) return null;
    if (used === null && remaining !== null) used = Math.max(limit - remaining, 0);
    if (remaining === null && used !== null) remaining = Math.max(limit - used, 0);
    if (remainingRatio === null && remaining !== null) remainingRatio = limit === 0 ? 0 : remaining / limit;
  }

  const state = limitKind === "unlimited" && !cooldownUntil && exhausted !== true ?
  "available" :
  deriveState({ exhausted, cooldownUntil, remaining, remainingRatio, limit });
  return {
    accountKey,
    resourceKey,
    dimensionKey,
    state,
    amounts: { limitKind, limit, used, remaining, remainingRatio, unit },
    resetAt,
    cooldownUntil,
    metadata
  };
}

export function boundedQuotaRow(options) {
  return quotaRow({ ...options, limitKind: "bounded" });
}

export function ratioQuotaRow({ remainingRatio, ...options }) {
  return quotaRow({ ...options, limitKind: "unknown", remainingRatio });
}

export function remainingQuotaRow({ remaining, ...options }) {
  return quotaRow({ ...options, limitKind: "unknown", remaining });
}