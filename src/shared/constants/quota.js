/** Canonical provider-quota vocabulary shared by persistence and later adapters. */
export const QUOTA_STATES = Object.freeze([
  "available",
  "low",
  "exhausted",
  "cooldown",
  "unknown",
  "error",
]);

export const QUOTA_LIMIT_KINDS = Object.freeze(["bounded", "unlimited", "unknown"]);

export const QUOTA_SOURCE_TYPES = Object.freeze(["provider_api", "response_headers", "import"]);

export const QUOTA_REASON_CODES = Object.freeze([
  "missing",
  "malformed",
  "unauthenticated",
  "forbidden",
  "rate_limited",
  "timeout",
  "network_error",
  "provider_error",
]);

export const QUOTA_FETCH_OUTCOMES = Object.freeze(["success", ...QUOTA_REASON_CODES]);

export const QUOTA_IDENTITY_DEFAULTS = Object.freeze({
  accountKey: "scope:connection",
  resourceKey: "scope:account",
});

export const QUOTA_METADATA_KEYS = Object.freeze([
  "displayName",
  "plan",
  "recurring",
  "windowSeconds",
]);

export const QUOTA_PORTABLE_VERSION = 1;
export const QUOTA_MAX_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const QUOTA_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const QUOTA_MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
export const QUOTA_DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const QUOTA_MAX_IMPORT_ROWS = 20_000;
export const QUOTA_MAX_SOURCE_SNAPSHOTS = 5_000;
export const DATABASE_IMPORT_MAX_BYTES = 16 * 1024 * 1024;
