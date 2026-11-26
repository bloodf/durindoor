const MODEL_LOCK_PREFIX = "modelLock_";

const modelLockValues = (connection) =>
  Object.entries(connection || {})
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && Boolean(value))
    .map(([, value]) => value);

/** Whether the connection carries any model or account lock field, lapsed or not. */
export function hasModelLock(connection) {
  return modelLockValues(connection).length > 0;
}

/** Earliest lock that is still in the future, or null when no lock is live (9router #3910). */
export function getEarliestActiveModelLock(connection, now = Date.now()) {
  const live = modelLockValues(connection)
    .map((value) => ({ value, until: new Date(value).getTime() }))
    .filter(({ until }) => until > now)
    .sort((a, b) => a.until - b.until);
  return live[0]?.value ?? null;
}
