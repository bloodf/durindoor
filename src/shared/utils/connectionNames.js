/**
 * Compute a safe default API-key connection name.
 *
 * Provider connection creation can upsert by provider/name, so additional
 * connections must avoid reusing the historical "main" default.
 *
 * @param {number} existingConnectionCount
 * @returns {string}
 */
export function computeDefaultConnectionName(existingConnectionCount = 0) {
  const count = Number(existingConnectionCount);
  return Number.isFinite(count) && count > 0 ? `main-${Math.floor(count) + 1}` : "main";
}
