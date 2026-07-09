import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

/**
 * API key repository.
 *
 * Expiry policy:
 * - `expiresAt` is stored as an ISO-8601 timestamp or null (never expires).
 * - Existing keys without an expiry are treated as never-expiring.
 * - Expired keys remain visible in the dashboard/CLI but stop authenticating requests.
 * - Setting `expiresAt` to null clears an existing expiry.
 */

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    allowedCombos: (() => { try { const v = JSON.parse(row.allowedCombos); return Array.isArray(v) ? v : []; } catch { return []; } })(),
    dailyLimitTokens: row.dailyLimitTokens ?? null,
    expiresAt: row.expiresAt || null,
    createdAt: row.createdAt,
  };
}

/**
 * Normalize an expiry value to either a valid ISO string or null (never expires).
 * Rejects unparseable or past dates. The value is round-tripped to ISO format.
 * @param {string|null|undefined} value
 * @returns {string|null}
 * @throws {Error} when the value is not a valid ISO timestamp or is not in the future
 */
function normalizeExpiresAt(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("expiresAt must be a valid ISO timestamp");
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new Error("expiresAt must be a valid ISO timestamp");
  if (time <= Date.now()) throw new Error("expiresAt must be in the future");
  return date.toISOString();
}

/**
 * Determine whether an expiresAt value has already passed.
 * Missing values are treated as never expiring; invalid non-empty values are treated as expired.
 * @param {string|null|undefined} expiresAt
 * @returns {boolean}
 */
function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  if (!Number.isFinite(time)) return true;
  return time <= Date.now();
}

function normalizeDailyLimitTokens(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("dailyLimitTokens must be a non-negative integer");
  return limit;
}

function getLocalDayStartIso(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, allowedCombos = [], dailyLimitTokens = null, expiresAt = null) {
  if (!machineId) throw new Error("machineId is required");
  const tokenLimit = normalizeDailyLimitTokens(dailyLimitTokens);
  const expiry = normalizeExpiresAt(expiresAt);
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    allowedCombos: Array.isArray(allowedCombos) ? allowedCombos : [],
    dailyLimitTokens: tokenLimit ?? null,
    expiresAt: expiry,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, JSON.stringify(apiKey.allowedCombos), apiKey.dailyLimitTokens, apiKey.expiresAt, apiKey.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const cleanData = { ...data };
    if ("dailyLimitTokens" in cleanData) cleanData.dailyLimitTokens = normalizeDailyLimitTokens(cleanData.dailyLimitTokens);
    if ("expiresAt" in cleanData) cleanData.expiresAt = normalizeExpiresAt(cleanData.expiresAt);
    const merged = { ...rowToKey(row), ...cleanData };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedCombos = ?, dailyLimitTokens = ?, expiresAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, JSON.stringify(merged.allowedCombos || []), merged.dailyLimitTokens ?? null, merged.expiresAt ?? null, id]
    );
    result = merged;
  });
  return result;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  if (!(row.isActive === 1 || row.isActive === true)) return false;
  return !isExpired(row.expiresAt);
}

export async function getApiKeyUsageLimitStatus(key, now = new Date()) {
  if (!key) return { enforced: false, exceeded: false };
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, dailyLimitTokens, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true) || isExpired(row.expiresAt)) return { enforced: false, exceeded: false };
  const limit = normalizeDailyLimitTokens(row.dailyLimitTokens);
  if (limit === null || limit === undefined) return { enforced: false, exceeded: false };
  const start = getLocalDayStartIso(now);
  const usedTokens = Number(db.get(
    `SELECT COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0) + COALESCE(json_extract(tokens, '$.reasoning_tokens'), 0)), 0) as usedTokens FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
    [key, start]
  )?.usedTokens || 0);
  return {
    enforced: true,
    exceeded: usedTokens >= limit,
    usedTokens,
    limitTokens: limit,
    remainingTokens: Math.max(0, limit - usedTokens),
    resetAt: new Date(new Date(now).setHours(24, 0, 0, 0)).toISOString(),
  };
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
