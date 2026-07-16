export function apiKeyConnectionNames(connections = []) {
  return connections
    .filter((connection) => connection?.authType === "apikey")
    .map((connection) => connection.name);
}

export function defaultApiKeyConnectionName(existingConnectionNames = []) {
  if (!Array.isArray(existingConnectionNames)) {
    const count = Number(existingConnectionNames);
    return Number.isFinite(count) && count > 0 ? `main-${Math.floor(count) + 1}` : "main";
  }

  const names = new Set(existingConnectionNames.map((name) => String(name || "").trim()).filter(Boolean));
  if (!names.has("main")) return "main";

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `main-${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

export function shouldResetAddApiKeyModal(previousIsOpen, nextIsOpen) {
  return !previousIsOpen && nextIsOpen;
}

/**
 * Allocate a collision-free "<base> <n>" name for one bulk-add entry.
 *
 * Background: the backend upserts apikey connections BY NAME within the
 * current provider (src/lib/db/repos/connectionsRepo.js: a colliding name
 * matches `c.authType === "apikey" && c.name === data.name` and OVERWRITES
 * the saved row instead of inserting a new one). Bulk-add used to derive
 * "<base> <pasteIndex>" from the paste position, blind to names already
 * saved, so re-adding keys often silently replaced earlier ones.
 *
 * This gap-fills the smallest free "<base> <n>" against both the provider's
 * existing apikey connection names and names already assigned earlier in the
 * same batch, so a generated name is never reused. The bulk route sends
 * createOnly, so the backend inserts or returns 409 — it never overwrites.
 * Comparison is case-insensitive to match user expectation.
 *
 * ponytail: only numeric-suffix collision is handled. A manually typed exact
 * existing non-numbered custom name still hits the backend upsert — but bulk
 * auto-naming always appends " <n>", so that path is unreachable from the
 * bulk modal. Upgrade path: a backend "skip-if-exists" flag if single-add
 * ever needs it.
 *
 * @param {string} base base name (e.g. "Key" or a custom "Prod")
 * @param {Set<string>} usedNames lower-cased names already taken (mutated)
 * @returns {string} the allocated "<base> <n>" name
 */
export function allocateBulkConnectionName(base, usedNames) {
  const safeBase = String(base || "").trim() || "Key";
  for (let n = 1; ; n += 1) {
    const candidate = `${safeBase} ${n}`;
    if (!usedNames.has(candidate.toLowerCase())) {
      usedNames.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/**
 * Build the lowercase name set a bulk-add run must avoid.
 *
 * @param {string[]|null|undefined} existingNames provider's saved apikey names
 * @returns {Set<string>} lower-cased names
 */
export function bulkUsedNameSet(existingNames) {
  const safe = Array.isArray(existingNames) ? existingNames : [];
  return new Set(safe.map((n) => (typeof n === "string" ? n.trim().toLowerCase() : "")).filter(Boolean));
}
