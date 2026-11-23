import { formatRetryAfter, getActiveModelLockUntil, isQuotaLockoutActive } from "open-sse/services/accountFallback.js";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
export function requestedLockScopes(rawModel, boundedModel) {
  return [...new Set([boundedModel, rawModel].filter((value) => value !== undefined))];
}

export function requestedModelLockActive(connection, rawModel, boundedModel, now) {
  return requestedModelLockUntil(connection, rawModel, boundedModel, now) !== null;
}

/** Shared read-only eligibility predicate used by combo preview and auth. */
export function isProviderConnectionModelLocked(connection, provider, model, now = Date.now()) {
  const boundedModel = resolveFallbackModelScope(resolveProviderId(provider), model);
  return isQuotaLockoutActive(connection, now) || requestedModelLockActive(connection, model, boundedModel, now);
}

export function requestedModelLockUntil(connection, rawModel, boundedModel, now) {
  const deadlines = requestedLockScopes(rawModel, boundedModel).
  map((scope) => getActiveModelLockUntil(connection, scope, now)).
  filter(Boolean).
  sort((left, right) => Date.parse(right) - Date.parse(left));
  return deadlines[0] || null;
}

export function blockedRetryAt(connection, decision, rawModel, boundedModel, now) {
  const deadlines = [];
  let unknown = false;
  if (isQuotaLockoutActive(connection, now)) {
    if (connection.quotaLockout.reactivateAt) deadlines.push(connection.quotaLockout.reactivateAt); else unknown = true;
  }
  if (requestedModelLockActive(connection, rawModel, boundedModel, now)) {
    const deadline = requestedModelLockUntil(connection, rawModel, boundedModel, now);
    if (deadline) deadlines.push(deadline);else
    unknown = true;
  }
  if (decision?.skip) {
    if (decision.retryAt) deadlines.push(decision.retryAt);else
    unknown = true;
  }
  if (unknown || deadlines.length === 0) return null;
  return deadlines.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function summarizeBlockedConnections(connections, decisions, rawModel, boundedModel, now) {
  const blocked = connections.filter((connection) =>
  requestedModelLockActive(connection, rawModel, boundedModel, now) || isQuotaLockoutActive(connection, now) || decisions.get(connection.id)?.skip
  );
  // Search locks have their own status; the row-wide errorCode describes chat.
  // An account-wide lock still uses the shared status. Older search locks with
  // no scoped status were rate limits, so keep their 429 fallback.
  const searchScope = boundedModel?.startsWith("websearch:") ? boundedModel : null;
  const legacyLocked = blocked.filter((connection) =>
    requestedModelLockActive(connection, rawModel, boundedModel, now)
  );
  const lockStatus = (connection) => searchScope && !getActiveModelLockUntil(connection, null, now) ?
  Number(connection[`modelError_${searchScope}`]) || 429 :
  Number(connection.errorCode);
  // Authentication failures must not be hidden by an earlier priority account's
  // rate-limit lock. Legacy 429 deadlines are combined with quota decisions
  // below so a no-reset exhaustion cannot expose the local breaker as provider
  // Retry-After evidence.
  const legacy = legacyLocked.find((connection) => [401, 403].includes(lockStatus(connection))) ||
  legacyLocked.find((connection) => lockStatus(connection) !== 429);
  if (legacy) {
    const code = lockStatus(legacy);
    const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 503;
    const message = status === 429 ?
    "Rate limited" :
    status === 401 ?
    "Authentication failed" :
    status === 403 ?
    "Access forbidden" :
    "Provider unavailable";
    const retryAfter = status === 429 ?
    requestedModelLockUntil(legacy, rawModel, boundedModel, now) :
    null;
    return {
      status,
      message,
      retryAfter,
      retryAfterHuman: retryAfter ? formatRetryAfter(retryAfter, now) : ""
    };
  }
  const retries = blocked.map((connection) => blockedRetryAt(
    connection,
    decisions.get(connection.id),
    rawModel,
    boundedModel,
    now
  ));
  const knownRetries = retries.filter(Boolean).sort((left, right) => Date.parse(left) - Date.parse(right));
  const earliest = retries.every(Boolean) || blocked.some((connection) => isQuotaLockoutActive(connection, now)) ? knownRetries[0] || null : null;
  return {
    status: 429,
    message: "Rate limited",
    retryAfter: earliest,
    retryAfterHuman: earliest ? formatRetryAfter(earliest, now) : ""
  };
}

