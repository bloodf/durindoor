// OpenAI-compatible error types mapping (client-facing)
import { isString } from "../../src/shared/utils/typeChecks.js";

export const CONTEXT_LENGTH_EXCEEDED_CODE = "context_length_exceeded";

export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  // A bare 403 carries no quota signal; misclassifying it as
  // insufficient_quota misleads quota-recovery/cooldown logic into treating a
  // plain refusal as billing exhaustion (OmniRoute #14234).
  403: { type: "permission_error", code: "permission_denied" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  410: { type: "invalid_request_error", code: "model_shutdown" },
  /** #3386: context overflow is a terminal client error. */
  413: { type: "invalid_request_error", code: CONTEXT_LENGTH_EXCEEDED_CODE },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Claude Messages API error types are distinct from the OpenAI-compatible
// types above. Keep this projection separate so OpenAI clients are unchanged.
export const CLAUDE_ERROR_TYPES = Object.freeze({
  400: "invalid_request_error",
  401: "authentication_error",
  402: "permission_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  429: "rate_limit_error",
  500: "api_error",
  502: "api_error",
  503: "overloaded_error",
  504: "timeout_error",
  529: "overloaded_error"
});

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "Permission denied",
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

/**
 * 4xx statuses that describe the credential or the route, not the request body,
 * and so keep rotating connections instead of being handed back to the client:
 * 412 is Fireworks' "account is suspended", 423 and 428 are account/route
 * preconditions (decolua/9router#4378). 409 stays request-scoped here on
 * purpose: tests/unit/account-fallback-request-scoped-4xx.test.js pins it.
 */
export const ACCOUNT_SCOPED_4XX_STATUSES = new Set([412, 423, 428]);

/**
 * Gateway/relay statuses: the hop in front of the origin answers while the
 * origin does not. 502/503/504 are also legitimate provider-application
 * statuses (an overloaded API answers 503 itself), so a bare one of them is
 * NOT proof that a relay failed. A bare 524 is not proof either.
 */
export const RELAY_GATEWAY_STATUSES = Object.freeze([502, 503, 504, 524]);

/**
 * Transport failures the fork's own transport layer classifies. No HTTP
 * response was received; the origin may nevertheless have received the request. "aborted" is deliberately absent: a client
 * abort is not a relay failure.
 */
export const RELAY_TRANSPORT_FAILURES = Object.freeze(["connect_timeout", "network"]);

/** Cooldown for HTTP 200 responses that contain no usable model output. */
export const EMPTY_CONTENT_COOLDOWN_MS = 7 * 60 * 1000;

// Envoy emits this transport-level marker when its retry buffer overflows.
export const REQUEST_REPLAY_BUFFER_ERROR = "exceeded request buffer limit while retrying upstream";

// Shared 502 message when a non-stream (or SSE→JSON) OpenAI completion ends with
// finish_reason "error" / otherwise fails the coherence gate (#1330 / #1089 Option A).
export const INCOHERENT_NON_STREAMING_RESPONSE_MESSAGE =
  "Provider returned an incoherent non-streaming response";

// Confirmed Kiro credit exhaustion (monthly quota, `resetAt` from GetUsageLimits) can be
// weeks away. Capping it at the generic 30-min window would re-probe a known-exhausted
// account every 30 minutes; cap it at a low-frequency daily probe so the account is
// retried roughly once a day — enough to notice an early reset (top-up, plan change)
// without hammering a known-dead account.
export const KIRO_CREDIT_EXHAUSTION_PROBE_MS = 24 * 60 * 60 * 1000;

// Per-provider override for the max resetsAtMs-derived cooldown (see markAccountUnavailable).
// Any provider not listed here falls back to MAX_RATE_LIMIT_COOLDOWN_MS.
export const RESET_COOLDOWN_CAP_MS = {
  kiro: KIRO_CREDIT_EXHAUSTION_PROBE_MS,
  "amazon-q": KIRO_CREDIT_EXHAUSTION_PROBE_MS
};

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  day: 24 * 60 * 60 * 1000
};

/**
 * Unified error classification rules.
 * Terminal status rules are resolved before text rules so a client error can
 * never rotate accounts merely because its message resembles a transient error.
 *
 * Each rule: { text?, pattern?, status?, cooldownMs?, backoff?, fallback? }
 *   - text: substring match (case-insensitive) on error message
 *   - pattern: regular expression match on error message
 *   - fallback: false = return without account/model fallback or cooldown
 *
 * Wrong-model errors can be reported as 400, 401 with a ModelError body, or
 * 404. They are terminal before the 401/404 cooldown rules. The fork retains
 * atomic model state in recordProviderConnectionFallbackState; no lastErrorModel
 * field is needed.
 */
/** Narrow permanent wrong-model matchers (#750), checked before 401/404 cooldowns. */
export const WRONG_MODEL_TEXT = [
  "model is not supported",
  "model not supported",
  "model not found",
  "model does not exist",
  "unknown model",
  // OpenRouter (and similar routers) echo the requested id: "<id> is not a valid model ID".
  // Keep this ahead of billing/capacity text rules so a client-chosen id containing
  // those phrases cannot bench the shared account (#2315).
  "not a valid model"];

export const WRONG_MODEL_PATTERNS = [
  /\bmodel\s+\S+\s+is\s+not\s+supported\b/,
  /\bmodel\s+\S+\s+(?:does\s+not\s+exist|not\s+found)\b/,
  /\bmodel\b.{0,128}\bnot\s+allowed\s+(?:on|for)\b.{0,128}\b(?:credential|key)\b/];

/**
 * @param {string|object|null|undefined} errorText - upstream error text or body
 * @returns {boolean} true when the text names a permanently wrong model
 */
export function isWrongModelError(errorText) {
  if (!errorText) return false;
  const text = (isString(errorText) ? errorText : JSON.stringify(errorText)).toLowerCase();
  if (WRONG_MODEL_TEXT.some((p) => text.includes(p))) return true;
  return WRONG_MODEL_PATTERNS.some((re) => re.test(text));
}

/** CodeBuddy account-restriction cooldown: upstream 9router #5342 uses 30 minutes. */
const CODEBUDDY_RESTRICTED_COOLDOWN_MS = 30 * 60 * 1000;
export const CODEBUDDY_PROVIDERS = Object.freeze(["codebuddy-cn", "codebuddy-intl"]);
// Plan and credit refusals describe this account, even on HTTP 400, so another account may serve.
const CODEBUDDY_ERROR_RULES = [
...["account has been restricted due to unusual activity", "账号存在异常行为"].
map((text) => ({ provider: CODEBUDDY_PROVIDERS, text, cooldownMs: CODEBUDDY_RESTRICTED_COOLDOWN_MS })),
...["model_not_in_plan", "当前账号类型暂不支持该模型", "your account type does not support this model",
"is not allowed for user type", "credits exhausted", "额度已用尽"].
map((text) => ({ provider: CODEBUDDY_PROVIDERS, text, cooldownMs: COOLDOWN.long }))];

/**
 * Codex refusals that name one account's model entitlement (decolua/9router#4381, #4373).
 * Another account or combo member may serve the model, so they must not read as
 * a permanently wrong model. Shared with the Codex executor's 200-SSE preflight.
 */
export const CODEX_ACCOUNT_MODEL_REJECTION_TEXT = Object.freeze([
"is not supported when using codex with a chatgpt account",
// Unavailable-model guidance (decolua/9router#4373).
"configured model is unavailable from the provider",
"not offered on this account"]);

export const ERROR_RULES = [
// Must precede the wrong-model rules: this text also contains "model is not supported".
...CODEX_ACCOUNT_MODEL_REJECTION_TEXT.map((text) => ({ text, cooldownMs: COOLDOWN.long })),
// --- Permanent wrong-model rules must precede 401/404 cooldowns (#750) ---
...WRONG_MODEL_TEXT.map((text) => ({ text, fallback: false })),
...WRONG_MODEL_PATTERNS.map((pattern) => ({ pattern, fallback: false })),
...CODEBUDDY_ERROR_RULES,
// --- Text-based rules (checked first, order = priority) ---
{ text: "no credentials", cooldownMs: COOLDOWN.long },
{ text: "request not allowed", cooldownMs: COOLDOWN.short },
// Explicit Antigravity account suspension/validation responses need a daily probe instead of the generic 2-minute 403 retry.
{ provider: ["antigravity", "ag"], text: "tos_violation", cooldownMs: COOLDOWN.day },
{ provider: ["antigravity", "ag"], text: "validation_required", cooldownMs: COOLDOWN.day },

// Terminal billing/credit states. Some providers report these as 429 (Z.AI/GLM
// code 1113 is a Chinese-language "insufficient balance" body), so without an
// explicit rule they fall through to the generic 429 backoff and get retried
// forever against an account that cannot recover without a top-up. Matched
// before the rate-limit rules so a balance error never looks transient.
//
// "insufficient credit" / "credit balance is too low" (9router b82f5c4 /
// #4713 → DurinDoor #1364) use the same long terminal cooldown so a 402
// OpenRouter body keeps main's 120s terminal lock instead of a 2s backoff,
// while HTTP 400 remaps and Anthropic's prepaid-empty message still rotate
// accounts and advance combos. Allowlist is phrase-exact (case-insensitive
// substring); unknown 4xx keep the request-scoped no-rotate path.
// Sources (message text, not invented codes):
// - "insufficient credit": OpenRouter / credit-reseller bodies such as
//   "Insufficient credits. Add more using https://openrouter.ai/settings/credits"
//   (OpenRouter docs: 402 payment_required; also seen remapped to HTTP 400).
// - "credit balance is too low": Anthropic Messages API HTTP 400
//   invalid_request_error message
//   "Your credit balance is too low to access the Anthropic API. Please go to
//   Plans & Billing to upgrade or purchase credits."
//   (anthropics/anthropic-sdk-typescript#618; observed wire shape still 400).
{ text: "余额不足", cooldownMs: COOLDOWN.long, terminal: true },
{ text: "insufficient balance", cooldownMs: COOLDOWN.long, terminal: true },
{ text: "请充值", cooldownMs: COOLDOWN.long, terminal: true },
{ text: "insufficient credit", cooldownMs: COOLDOWN.long, terminal: true },
{ text: "credit balance is too low", cooldownMs: COOLDOWN.long, terminal: true },

{ text: "rate limit", backoff: true },
{ text: "too many requests", backoff: true },
{ text: "quota exceeded", backoff: true },
{ text: "quota reached", backoff: true },
{ text: "individual quota", backoff: true },
{ text: "capacity", backoff: true },
{ text: "overloaded", backoff: true },

// --- Status-based rules (fallback when text doesn't match) ---
{ status: 401, cooldownMs: COOLDOWN.long },
{ status: 402, cooldownMs: COOLDOWN.long, terminal: true },
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
