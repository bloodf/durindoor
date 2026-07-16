/**
 * Availability-based connection ordering for the provider dashboard.
 *
 * Ported from decolua/9router upstream PR #2558 (dispatched under plan slot
 * #2557; the upstream PR numbers for this change and the random-available
 * strategy are swapped relative to their live titles).
 *
 * A connection is "available" when its effective status is `active` or
 * `success`. `unavailable` is treated as `active` unless the connection has a
 * live `modelLock_*` cooldown (lock timestamp in the future) — an
 * "unavailable" probe without an active lock is a transient state, not a dead
 * connection.
 *
 * `Array.prototype.sort` is stable, so the comparator returning 0 for ties
 * preserves the existing (manual) priority order within each availability
 * group.
 */

/**
 * @param {object} connection provider connection row
 * @param {number} [now] current time in ms (injectable for deterministic tests)
 * @returns {string} effective status
 */
export function getEffectiveConnectionStatus(connection, now = Date.now()) {
  const hasActiveCooldown = Object.entries(connection).some(
    ([key, value]) => key.startsWith("modelLock_") && value && new Date(value).getTime() > now
  );
  return connection.testStatus === "unavailable" && !hasActiveCooldown ? "active" : connection.testStatus;
}

/**
 * @param {object} connection
 * @param {number} [now]
 * @returns {boolean} whether the connection can serve requests now
 */
export function isConnectionAvailable(connection, now = Date.now()) {
  // A disabled connection cannot serve requests now regardless of how healthy
  // its last probe looked — exclude it from the available group.
  if (connection.isActive === false) return false;
  const status = getEffectiveConnectionStatus(connection, now);
  return status === "active" || status === "success";
}

/**
 * Returns a new array with available connections first. Stable: relative order
 * within each availability group is unchanged from the input.
 *
 * @param {object[]} connections
 * @param {number} [now]
 * @returns {object[]} sorted copy (input not mutated)
 */
export function sortConnectionsByAvailability(connections, now = Date.now()) {
  return [...connections].sort((a, b) => {
    const availableA = isConnectionAvailable(a, now);
    const availableB = isConnectionAvailable(b, now);
    if (availableA && !availableB) return -1;
    if (!availableA && availableB) return 1;
    return 0;
  });
}
