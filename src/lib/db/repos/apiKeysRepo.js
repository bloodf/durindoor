import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function parseApiKeyPolicy(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.length) {
    // Preserve malformed storage as an invalid value. Returning null here
    // would downgrade a corrupt restrictive policy into unrestricted access.
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return null;
}

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
    policy: parseApiKeyPolicy(row.policy),
    expiresAt: row.expiresAt || null,
    createdAt: row.createdAt,
  };
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

export async function createApiKey(name, machineId, allowedCombos = [], dailyLimitTokens = null) {
  if (!machineId) throw new Error("machineId is required");
  const tokenLimit = normalizeDailyLimitTokens(dailyLimitTokens);
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
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, JSON.stringify(apiKey.allowedCombos), apiKey.dailyLimitTokens, apiKey.createdAt]
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
    const merged = { ...rowToKey(row), ...cleanData };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedCombos = ?, dailyLimitTokens = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, JSON.stringify(merged.allowedCombos || []), merged.dailyLimitTokens ?? null, id]
    );
    result = merged;
  });
  return result;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

export async function getApiKeyUsageLimitStatus(key, now = new Date()) {
  if (!key) return { enforced: false, exceeded: false };
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, dailyLimitTokens FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true)) return { enforced: false, exceeded: false };
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
