// OmniRoute #20980 (9ac2e52d18b0): a model-only lock answers with the upstream
// error that created it. The connection-wide `errorCode`/`lastError` belong to
// whichever model failed last, so they cannot answer for this one.
//
// Only 400/402 keep their upstream message: they tell a client "add credit"
// rather than "wait". Every other status keeps the fixed per-status wording.
const BILLING_STATUSES = new Set([400, 402]);
const PREFIX = "modelUpstream_";

/**
 * Fields to merge when a failure (re)locks `scope`. The record is bound to the
 * lock deadline, so a lock written by any other path never inherits it.
 * `__all` locks are described by the connection-wide fields.
 */
export function modelUpstreamUpdate(scope, { status, message, lockUntil }) {
  if (!scope || scope === "__all") return {};
  const code = Number(status) || null;
  return {
    [`${PREFIX}${scope}`]: { status: code, message: BILLING_STATUSES.has(code) ? message : null, lockUntil }
  };
}

/** The record behind the first of `scopes` whose lock is still the one it described, or null. */
export function activeModelUpstreamError(connection, scopes, now) {
  for (const scope of scopes) {
    const record = scope ? connection?.[`${PREFIX}${scope}`] : null;
    if (record && record.lockUntil === connection[`modelLock_${scope}`] && Date.parse(record.lockUntil) > now) {
      return record;
    }
  }
  return null;
}
