import { isString } from "@/shared/utils/typeChecks.js"; // OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  410: { type: "invalid_request_error", code: "model_shutdown" },
  /** #3386: context overflow is a terminal client error. */
  413: { type: "invalid_request_error", code: "context_length_exceeded" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  410: "Model shut down",
  /** #3386: default message for terminal context overflow. */
  413: "Context length exceeded",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

/**
 * Hard cap for provider-reported and configured rate-limit cooldowns.
 * Keeps generated account lock deadlines representable as ISO timestamps.
 */
export const MAX_RATE_LIMIT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolves the rate-limit backoff schedule from environment variables (#3352).
 * Invalid knobs retain their historical defaults; the configured maximum is
 * clamped to a deadline-safe cap; contradictory schedules fall back completely.
 */
const DEFAULT_BACKOFF_CONFIG = Object.freeze({
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
});

function parsePositiveInteger(value) {
  if (!isString(value) || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveBackoffConfig(env = process.env) {
  const config = {
    base: parsePositiveInteger(env.BACKOFF_BASE_MS) ?? DEFAULT_BACKOFF_CONFIG.base,
    max: Math.min(
      parsePositiveInteger(env.BACKOFF_MAX_MS) ?? DEFAULT_BACKOFF_CONFIG.max,
      MAX_RATE_LIMIT_COOLDOWN_MS
    ),
    maxLevel: parsePositiveInteger(env.BACKOFF_MAX_LEVEL) ?? DEFAULT_BACKOFF_CONFIG.maxLevel
  };

  return config.max < config.base ? DEFAULT_BACKOFF_CONFIG : Object.freeze(config);
}

export const BACKOFF_CONFIG = resolveBackoffConfig();

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Envoy emits this transport-level marker when its retry buffer overflows.
export const REQUEST_REPLAY_BUFFER_ERROR = "exceeded request buffer limit while retrying upstream";

// Confirmed Kiro credit exhaustion (monthly quota, `resetAt` from GetUsageLimits) can be
// weeks away. Capping it at the generic 30-min window would re-probe a known-exhausted
// account every 30 minutes; cap it at a low-frequency daily probe so the account is
// retried roughly once a day — enough to notice an early reset (top-up, plan change)
// without hammering a known-dead account.
export const KIRO_CREDIT_EXHAUSTION_PROBE_MS = 24 * 60 * 60 * 1000;

// Per-provider override for the max resetsAtMs-derived cooldown (see markAccountUnavailable).
// Any provider not listed here falls back to MAX_RATE_LIMIT_COOLDOWN_MS.
export const RESET_COOLDOWN_CAP_MS = {
  kiro: KIRO_CREDIT_EXHAUSTION_PROBE_MS
};

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000
};

/**
 * Unified error classification rules.
 * Terminal status rules are resolved before text rules so a client error can
 * never rotate accounts merely because its message resembles a transient error.
 *
 * Each rule: { text?, status?, cooldownMs?, backoff?, fallback? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 *   - fallback: false = return without account/model fallback or cooldown
 *
 * Upstream provenance: decolua/9router#3386.
 */
export const ERROR_RULES = [
// --- Text-based rules (checked first, order = priority) ---
{ text: "no credentials", cooldownMs: COOLDOWN.long },
{ text: "request not allowed", cooldownMs: COOLDOWN.short },
{ text: "rate limit", backoff: true },
{ text: "too many requests", backoff: true },
{ text: "quota exceeded", backoff: true },
{ text: "quota reached", backoff: true },
{ text: "individual quota", backoff: true },
{ text: "capacity", backoff: true },
{ text: "overloaded", backoff: true },

// --- Status-based rules (fallback when text doesn't match) ---
{ status: 401, cooldownMs: COOLDOWN.long },
{ status: 402, cooldownMs: COOLDOWN.long },
{ status: 403, cooldownMs: COOLDOWN.long },
{ status: 404, cooldownMs: COOLDOWN.long },
{ status: 413, fallback: false },
{ status: 429, backoff: true }];


// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short
};