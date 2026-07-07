/**
 * Compute a safe default API-key connection name.
 *
 * Provider connection creation can upsert by provider/name, so additional
 * connections must avoid reusing the historical "main" default.
 *
 * @param {string[] | number} existingNamesOrCount - names already used for this provider, or legacy count
 * @returns {string}
 */
export function computeDefaultConnectionName(existingNamesOrCount = 0) {
  if (typeof existingNamesOrCount === "number") {
    const count = Number(existingNamesOrCount);
    return Number.isFinite(count) && count > 0 ? `main-${Math.floor(count) + 1}` : "main";
  }
  const names = Array.isArray(existingNamesOrCount) ? existingNamesOrCount : [];
  const maxMainSuffix = names.reduce((max, name) => {
    if (name === "main") return Math.max(max, 1);
    const match = /^main-(\d+)$/.exec(name);
    if (match) return Math.max(max, Number(match[1]));
    return max;
  }, 0);
  return maxMainSuffix === 0 ? "main" : `main-${maxMainSuffix + 1}`;
}
