import { isNumber, isObject, isString } from "@/shared/utils/typeChecks.js"; /**
 * Kimi uses the same 403 wording for two different conditions: a depleted
 * weekly subscription and a temporary request window. The latter must stay
 * recoverable, otherwise a healthy subscription is marked terminal.
 */

function asRecord(value) {
  return value && isObject(value) && !Array.isArray(value) ? value : null;
}

function remaining(value) {
  if (!value) return null;
  const candidate = value.remaining ?? value.remainingPercentage;
  const parsed = isNumber(candidate) ? candidate : Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {unknown} usage - result of getUsageForProvider(kimi connection)
 * @param {number} nowMs
 * @returns {string|null} ISO reset timestamp when the failure is a recoverable
 *   temporary rate limit, otherwise null (weekly quota exhausted, malformed
 *   data, or the rate-limit window already has capacity).
 */
export function getKimiTemporaryRateLimitResetAt(usage, nowMs = Date.now()) {
  const quotas = asRecord(asRecord(usage)?.quotas);
  const rateLimit = asRecord(quotas?.Ratelimit);
  const weekly = asRecord(quotas?.Weekly);
  const rateLimitRemaining = remaining(rateLimit);
  const weeklyRemaining = remaining(weekly);
  const resetAt = isString(rateLimit?.resetAt) ? rateLimit.resetAt : null;
  const resetMs = resetAt ? new Date(resetAt).getTime() : NaN;

  if (
  rateLimitRemaining !== 0 ||
  weeklyRemaining === null ||
  weeklyRemaining <= 0 ||
  !Number.isFinite(resetMs) ||
  resetMs <= nowMs)
  {
    return null;
  }

  return resetAt;
}