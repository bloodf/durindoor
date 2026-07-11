import { parseAbsoluteTimestamp } from "./absoluteTimestamp.js";

export function isAbsoluteApiKeyExpiryTimestamp(value) {
  return parseAbsoluteTimestamp(value) !== null;
}

export class ApiKeyExpiryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiKeyExpiryValidationError";
    this.code = "INVALID_API_KEY_EXPIRY";
  }
}

/** Canonicalize an absolute timestamp while permitting already-expired history. */
export function canonicalizeApiKeyExpiresAt(value) {
  if (value === null) return null;
  const time = parseAbsoluteTimestamp(value);
  if (time === null) {
    throw new ApiKeyExpiryValidationError("expiresAt must be an absolute ISO-8601 timestamp with a timezone");
  }
  return new Date(time).toISOString();
}

/** Convert a future absolute ISO-8601 timestamp to canonical UTC storage. */
export function normalizeApiKeyExpiresAt(value, now = Date.now()) {
  const canonical = canonicalizeApiKeyExpiresAt(value);
  if (canonical === null) return null;
  const time = Date.parse(canonical);
  const nowTime = Number(now);
  if (!Number.isFinite(nowTime) || time <= nowTime) {
    throw new ApiKeyExpiryValidationError("expiresAt must be in the future");
  }
  return canonical;
}

/** Missing expiry never expires; malformed stored values fail closed. */
export function isApiKeyExpired(value, now = Date.now()) {
  if (value === null || value === undefined) return false;
  const time = parseAbsoluteTimestamp(value);
  const nowTime = Number(now);
  return time === null || !Number.isFinite(nowTime) || time <= nowTime;
}

export function isApiKeyExpiryValidationError(error) {
  return error?.code === "INVALID_API_KEY_EXPIRY";
}
