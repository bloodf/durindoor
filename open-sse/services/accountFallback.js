import { ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS, REQUEST_REPLAY_BUFFER_ERROR } from "../config/errorConfig.js";
import { parseRateLimitEvidence } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getProviderErrorRuleMatch, resolveRuleMatchBody } from "../config/providerErrorRules.js";

/**
 * Identify Envoy retry-buffer overflow responses that are safe to replay on
 * the same account because they carry no credential or quota evidence.
 * @param {number} status - HTTP status code
 * @param {unknown} errorText - Upstream error body
 * @returns {boolean} Whether the request should be replayed in place
 */
import { isString } from "../../src/shared/utils/typeChecks.js";
export function isRequestReplayBufferError(status, errorText) {
  if (Number(status) !== HTTP_STATUS.INSUFFICIENT_STORAGE) return false;
  const message = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  return message.toLowerCase().includes(REQUEST_REPLAY_BUFFER_ERROR);
}

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: terminal status rules win before text rules, then remaining
 * ERROR_RULES match top-to-bottom. Known account/quota text rules take
 * precedence otherwise; deterministic 400/422 client failures do not rotate.
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @param {string} provider - Optional provider ID for provider-specific rules
 * @param {Headers|object|null} headers - Optional upstream response headers
 * @param {unknown} structuredError - Optional parsed upstream error body
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number, rateLimitEvidence?: object }}
 *   `rateLimitEvidence` is present only on an explicit quota-exhausted 429,
 *   so markAccountUnavailable can persist state:"exhausted" instead of an
 *   ordinary cooldown.
 */
export function checkFallbackError(status, errorText, backoffLevel = 0, provider = null, headers = null, structuredError = null) {
  const normalizedText = errorText ?
  isString(errorText) ? errorText : JSON.stringify(errorText) :
  "";
  const lowerError = normalizedText.toLowerCase();

  if (isRequestReplayBufferError(status, errorText)) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // External/client HTTP 499 is terminal; combo-owned timeout fallback is handled in combo.js.
  if (Number(status) === 499) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  /** #3386: terminal client errors win before message-based transient rules. */
  const terminalRule = ERROR_RULES.find((rule) => rule.status === status && rule.fallback === false);
  if (terminalRule) {
    return { shouldFallback: false, cooldownMs: 0, newBackoffLevel: backoffLevel, scope: null };
  }

  // Port-pending guards are explicit feature-not-implemented errors; they should not
  // lock the user's connection or trigger the account fallback cooldown chain.
  if (lowerError.includes("provider_port_pending")) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // Anthropic 400 invalid_request_error is a client-side request schema failure;
  // switching accounts will not fix it, so do not fall back.
  if (Number(status) === 400 && lowerError.includes("invalid_request_error")) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // Codex invalid_encrypted_content is a stale-reasoning request issue recovered
  // in-place by the Codex executor; switching accounts will not fix it (#2667).
  const invalidEncryptedContent = lowerError.includes("invalid_encrypted_content") ||
  lowerError.includes("encrypted content") && (
  lowerError.includes("could not be verified") || lowerError.includes("could not be decrypted or parsed"));
  if (Number(status) === 400 && invalidEncryptedContent) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  // A per-request content rejection (e.g. provider content filter blocking a
  // single prompt) is not an account/auth/quota failure; it must never lock the
  // connection or trigger the account-fallback cooldown chain.
  if (lowerError.includes("provider_request_rejected")) {
    return { shouldFallback: false, cooldownMs: 0, scope: null };
  }

  const providerRule = getProviderErrorRuleMatch(
    provider,
    status,
    headers,
    resolveRuleMatchBody(provider, structuredError, errorText)
  );
  if (providerRule?.reason === "quota_exhausted") {
    const ruleResult = checkFallbackErrorByRules(HTTP_STATUS.RATE_LIMITED, lowerError, backoffLevel);
    return { ...ruleResult, scope: providerRule.scope ?? null };
  }
  if (providerRule?.cooldownMs) {
    return {
      shouldFallback: true,
      cooldownMs: providerRule.cooldownMs,
      newBackoffLevel: 0,
      scope: providerRule.scope ?? null
    };
  }

  // OmniRoute #6731: an apikey-category 429 whose body explicitly reports an
  // exhausted daily/weekly/monthly quota must honor the real reset window, not
  // the generic exponential backoff. Reuse the native evidence parser so an
  // explicit "reset in N days/weeks" deadline benches the account precisely.
  // Only state==="exhausted" applies here — a plain transient 429 (no quota
  // signal) keeps the exponential-backoff path below untouched.
  if (status === 429) {
    const now = Date.now();
    const evidence = parseRateLimitEvidence({ status, bodyText: normalizedText, now });
    if (evidence?.state === "exhausted") {
      // Resetless exhaustion: no parseable deadline, so fall through to the
      // rule loop for the (short) bench duration but preserve the classifier
      // verdict. markAccountUnavailable adopts rateLimitEvidence when the
      // caller did not supply one, keeping state:"exhausted" + retryAtKnown
      // instead of persisting this as an ordinary cooldown.
      if (Number.isFinite(evidence.resetAtMs)) {
        // Clamp the parsed reset to the hard cap in this text-quota path so
        // monthly "reset in 14 days" still benches for the cap rather than
        // being discarded as resetless exhaustion.
        const clampedReset = Math.min(evidence.resetAtMs, now + MAX_RATE_LIMIT_COOLDOWN_MS);
        return {
          shouldFallback: true,
          cooldownMs: Math.max(0, clampedReset - now),
          newBackoffLevel: 0,
          rateLimitEvidence: evidence,
          scope: null
        };
      }
      const fallback = checkFallbackErrorByRules(status, lowerError, backoffLevel);
      return { ...fallback, rateLimitEvidence: evidence, scope: null };
    }
  }

  const generic = checkFallbackErrorByRules(status, lowerError, backoffLevel);
  return { ...generic, scope: null };
}

function checkFallbackErrorByRules(status, lowerError, backoffLevel) {
  for (const rule of ERROR_RULES) {
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.fallback === false) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    // Pattern-based rule: regex match, for phrases the model name sits inside
    // ("Model does-not-exist-xyz is not supported") that a substring cannot span.
    if (rule.pattern && lowerError && rule.pattern.test(lowerError)) {
      if (rule.fallback === false) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.fallback === false) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }
  }

  if (status === 400 || status === 422) {
    return { shouldFallback: false, cooldownMs: 0 };
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Antigravity capacity is a per-request server saturation signal, not an
 * account quota/rate-limit. It should skip the current connection only for
 * this request and must not write cooldown state to DB.
 */
export function isAntigravityCapacityError(status, errorText = "") {
  const text = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  return Number(status) === 503 && (
  /MODEL_CAPACITY_EXHAUSTED/i.test(text) ||
  /No capacity available for model/i.test(text));

}

const CLOUD_CODE_ACCOUNT_DISABLED_403_PATTERNS = [
/disabled in this account/i,
/account[^.:\n]*(?:disabled|deactivated|suspended|banned|terminated|closed)/i,
/verify your account/i,
/violation of (?:the )?terms/i,
/terms of service/i];


const CLOUD_CODE_PROJECT_403_PATTERNS = [
/has not been used in project/i,
/accessNotConfigured/i,
/cloud ai companion api/i,
/cloudcode-pa\.googleapis\.com/i,
/api has not been (?:used|enabled)/i,
/SERVICE_DISABLED/];


/**
 * Cloud Code / Antigravity 403s are recoverable only when the error identifies
 * a project/API setup issue. Account verification, deactivation, suspension, or
 * ToS-ban messages are real account failures and must keep normal cooldown
 * handling, even when they come from a Cloud Code provider.
 */
export function isRecoverableCloudCodeProject403(provider, status, errorText = "") {
  if (Number(status) !== 403) return false;
  const p = String(provider || "").toLowerCase();
  const isCloudCodeProvider =
  p === "antigravity" ||
  p === "gemini-cli" ||
  p.includes("cloudcode") ||
  p.includes("cloud-code");
  const text = isString(errorText) ? errorText : JSON.stringify(errorText || "");
  if (CLOUD_CODE_ACCOUNT_DISABLED_403_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const hasProjectMarker = CLOUD_CODE_PROJECT_403_PATTERNS.some((pattern) => pattern.test(text)) ||
  /PERMISSION_DENIED/.test(text) && /\b(project|api|cloud ai companion|cloudcode-pa)\b/i.test(text);

  return isCloudCodeProvider && hasProjectMarker;
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil, now = Date.now()) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - now;
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor(totalSec % 3600 / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check whether an exact-model or account-wide lock is still active.
 * Each applicable timestamp is validated independently so an expired exact
 * lock cannot mask an active account-wide lock.
 *
 * @param {object} connection - Provider connection containing flat lock fields.
 * @param {string|null} model - Requested model, or null for an account-wide lock.
 * @returns {boolean} Whether either applicable lock expires in the future.
 */
export function isModelLockActive(connection, model) {
  const now = Date.now();
  const exactExpiry = new Date(connection[getModelLockKey(model)] || "").getTime();
  const accountExpiry = new Date(connection[MODEL_LOCK_ALL] || "").getTime();
  const exactActive = Number.isFinite(exactExpiry) && exactExpiry > now;
  const accountActive = Number.isFinite(accountExpiry) && accountExpiry > now;
  return exactActive || accountActive;
}

/** Return the later applicable exact/account lock for one requested model. */
export function getActiveModelLockUntil(connection, model, now = Date.now()) {
  if (!connection) return null;
  const candidates = [connection[getModelLockKey(model)], connection[MODEL_LOCK_ALL]].
  map((value) => ({ value, timestamp: new Date(value || "").getTime() })).
  filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp > now);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  return new Date(candidates[0].timestamp).toISOString();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Decide whether a fallback lock must be account-wide for a provider that has
 * opted into connection-wide error scoping (#6888).
 *
 * Only NVIDIA NIM (and any future provider explicitly flagged with
 * `passthroughConnectionWideErrors`) treats connection-class failures as
 * indicting the shared connection itself. A per-model 404 (stale/renamed
 * catalog id) or 429 (transient rate limit) retains the existing bounded
 * scope — the caller's canonical-model lock when the catalog id resolves,
 * account-wide when it does not (bounded-key invariant). Only failures where
 * the shared connection itself is at fault (5xx, or status 0 for network/
 * no-response) force the account-wide lock (`modelLock___all`).
 *
 * Providers without `passthroughConnectionWideErrors` are unaffected: callers
 * only consult this helper when the registry sets the flag, so OpenRouter and
 * other passthrough routers keep their 5xx responses model-scoped.
 *
 * @param {boolean} connectionWideErrors - registry `passthroughConnectionWideErrors` flag for the resolved provider
 * @param {number} status - HTTP status code from upstream (0 = network/no response)
 * @returns {boolean} true when the lock must be account-wide
 */
export function isPassthroughConnectionWideError(connectionWideErrors, status) {
  if (connectionWideErrors !== true) return false;
  const code = Number(status) || 0;
  return code === 0 || code >= 500;
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter((acc) => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @param {string} provider - Optional provider ID for provider-specific rules
 * @param {Headers|object|null} headers - Optional upstream response headers
 * @param {unknown} structuredError - Optional parsed upstream error body
 * @returns {object} Updated account with error state. `providerErrorScope`
 *   is set when a provider rule returned a `scope` (e.g. AgentRouter quota
 *   `connection`) so the lock layer can pick account-wide persistence.
 */
export function applyErrorState(account, status, errorText, provider = null, headers = null, structuredError = null) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel, scope } = checkFallbackError(
    status,
    errorText,
    backoffLevel,
    provider,
    headers,
    structuredError
  );

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error",
    ...(scope ? { providerErrorScope: scope } : null)
  };
}