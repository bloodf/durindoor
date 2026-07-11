import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { isApiKeyExpired, normalizeApiKeyExpiresAt } from "@/shared/utils/apiKeyExpiry";
import { mergeApiKeyPolicy, normalizeApiKeyPolicy } from "../helpers/apiKeyPolicy.js";
import { getCommittedTokenCount } from "../helpers/committedTokens.js";

/**
 * API key repository.
 *
 * Expiry policy:
 * - `expiresAt` is stored as an ISO-8601 timestamp or null (never expires).
 * - Existing keys without an expiry are treated as never-expiring.
 * - Expired keys remain visible in the dashboard/CLI but stop authenticating requests.
 * - Setting `expiresAt` to null clears an existing expiry.
 */

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
    expiresAt: row.expiresAt ?? null,
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

export async function createApiKey(name, machineId, allowedCombos = [], dailyLimitTokens = null, expiresAt = null, optionsOrNow = {}) {
  if (!machineId) throw new Error("machineId is required");
  const options = typeof optionsOrNow === "number" ? { now: optionsOrNow } : (optionsOrNow || {});
  const now = options.now ?? Date.now();
  const tokenLimit = normalizeDailyLimitTokens(dailyLimitTokens);
  const expiry = normalizeApiKeyExpiresAt(expiresAt, now);
  const policy = normalizeApiKeyPolicy(options.policy ?? null);
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
    policy,
    expiresAt: expiry,
    createdAt: new Date(Number(now)).toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, JSON.stringify(apiKey.allowedCombos), apiKey.dailyLimitTokens, policy == null ? null : JSON.stringify(policy), apiKey.expiresAt, apiKey.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data, now = Date.now()) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = rowToKey(row);
    if (Object.hasOwn(data, "name")) merged.name = data.name;
    if (Object.hasOwn(data, "isActive")) merged.isActive = data.isActive === true;
    if (Object.hasOwn(data, "allowedCombos")) merged.allowedCombos = Array.isArray(data.allowedCombos) ? [...data.allowedCombos] : [];
    if (Object.hasOwn(data, "dailyLimitTokens")) merged.dailyLimitTokens = normalizeDailyLimitTokens(data.dailyLimitTokens);
    if (Object.hasOwn(data, "expiresAt")) merged.expiresAt = normalizeApiKeyExpiresAt(data.expiresAt, now);
    const updatesPolicy = Object.hasOwn(data, "policy") || Object.hasOwn(data, "policyPatch");
    if (Object.hasOwn(data, "policy")) merged.policy = normalizeApiKeyPolicy(data.policy);
    if (Object.hasOwn(data, "policyPatch")) merged.policy = mergeApiKeyPolicy(merged.policy, data.policyPatch);
    const policyStorage = updatesPolicy
      ? (merged.policy == null ? null : JSON.stringify(merged.policy))
      : row.policy;
    db.run(
      `UPDATE apiKeys SET name = ?, isActive = ?, allowedCombos = ?, dailyLimitTokens = ?, policy = ?, expiresAt = ? WHERE id = ?`,
      [merged.name, merged.isActive ? 1 : 0, JSON.stringify(merged.allowedCombos || []), merged.dailyLimitTokens ?? null, policyStorage, merged.expiresAt ?? null, id]
    );
    result = merged;
  });
  return result;
}

export async function validateApiKey(key, now = Date.now()) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  if (!(row.isActive === 1 || row.isActive === true)) return false;
  return !isApiKeyExpired(row.expiresAt, now);
}

export async function getApiKeyUsageLimitStatus(key, now = new Date()) {
  if (!key) return { enforced: false, exceeded: false };
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, dailyLimitTokens, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true) || isApiKeyExpired(row.expiresAt, now.getTime())) return { enforced: false, exceeded: false };
  const limit = normalizeDailyLimitTokens(row.dailyLimitTokens);
  if (limit === null || limit === undefined) return { enforced: false, exceeded: false };
  const start = getLocalDayStartIso(now);
  const usedTokens = db.all(
    `SELECT promptTokens, completionTokens, tokens FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
    [key, start],
  ).reduce((total, usage) => {
    let tokens = {};
    try { tokens = usage.tokens ? JSON.parse(usage.tokens) : {}; } catch { tokens = {}; }
    return total + getCommittedTokenCount(tokens, usage);
  }, 0);
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
