import { getAdapter } from "../driver.js";

function isMissingTable(err) {
  return /no such table:\s*modelCapabilityOverrides/i.test(String(err?.message || err));
}

/**
 * Get a manual capability override for a provider/model/key.
 * @param {string | null} provider
 * @param {string | null} modelId
 * @param {string} overrideKey
 * @returns {Promise<any | null>}
 */
export async function getModelCapabilityOverride(provider, modelId, overrideKey) {
  if (!provider || !modelId || !overrideKey) return null;
  const db = await getAdapter();
  let row;
  try {
    row = db.get(
      `SELECT overrideValue FROM modelCapabilityOverrides WHERE provider = ? AND modelId = ? AND overrideKey = ?`,
      [provider, modelId, overrideKey],
    );
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
  if (!row) return null;
  try {
    return JSON.parse(row.overrideValue);
  } catch {
    return row.overrideValue;
  }
}

/**
 * Set a manual capability override.
 * @param {string} provider
 * @param {string} modelId
 * @param {string} overrideKey
 * @param {any} overrideValue
 */
export async function setModelCapabilityOverride(provider, modelId, overrideKey, overrideValue) {
  if (!provider || !modelId || !overrideKey) return;
  const db = await getAdapter();
  const value = typeof overrideValue === "string" ? overrideValue : JSON.stringify(overrideValue);
  db.run(
    `INSERT INTO modelCapabilityOverrides(provider, modelId, overrideKey, overrideValue, refreshedAt)
     VALUES(?, ?, ?, ?, datetime('now'))
     ON CONFLICT(provider, modelId, overrideKey) DO UPDATE SET
       overrideValue = excluded.overrideValue,
       refreshedAt = excluded.refreshedAt`,
    [provider, modelId, overrideKey, value],
  );
}

/**
 * Delete a manual capability override.
 * @param {string} provider
 * @param {string} modelId
 * @param {string} overrideKey
 */
export async function deleteModelCapabilityOverride(provider, modelId, overrideKey) {
  if (!provider || !modelId || !overrideKey) return;
  const db = await getAdapter();
  db.run(
    `DELETE FROM modelCapabilityOverrides WHERE provider = ? AND modelId = ? AND overrideKey = ?`,
    [provider, modelId, overrideKey],
  );
}
