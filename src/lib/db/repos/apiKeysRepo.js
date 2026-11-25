import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { isApiKeyExpired, normalizeApiKeyExpiresAt } from "@/shared/utils/apiKeyExpiry";
import { mergeApiKeyPolicy, normalizeApiKeyPolicy } from "../helpers/apiKeyPolicy.js";
import { apiKeyUsageScope } from "../helpers/apiKeyAttribution.js";
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
import { isBoolean, isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";

// Invalid input must never silently remove a key's combo restriction.
function validateAllowedCombos(value) {
  if (!Array.isArray(value) || value.some((item) => !isString(item))) {
    throw new TypeError("allowedCombos must be an array of strings");
  }
  return [...value];
}

function parseApiKeyPolicy(raw) {
  if (raw == null) return null;
  if (isObject(raw)) return raw;
  if (isString(raw) && raw.length) {
    // Preserve malformed storage as an invalid value. Returning null here
    // would downgrade a corrupt restrictive policy into unrestricted access.
    try {return JSON.parse(raw);} catch {return raw;}
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
    allowedCombos: (() => {try {const v = JSON.parse(row.allowedCombos);return Array.isArray(v) ? v : [];} catch {return [];}})(),
    dailyLimitTokens: row.dailyLimitTokens ?? null,
    policy: parseApiKeyPolicy(row.policy),
    expiresAt: row.expiresAt ?? null,
    isAdmin: row.isAdmin === 1 || row.isAdmin === true,
    createdAt: row.createdAt
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

function replaceProviderConnectionScopeInTx(db, apiKeyId, connectionIds) {
  if (!Array.isArray(connectionIds)) throw new TypeError("providerConnectionIds must be an array");
  const ids = connectionIds.map((id) => {
    if (!isString(id) || !id.trim()) throw new TypeError("providerConnectionIds entries must be non-empty strings");
    return id.trim();
  });
  if (new Set(ids).size !== ids.length) throw new TypeError("providerConnectionIds must not contain duplicates");
  const existing = new Set(db.all("SELECT id FROM providerConnections").map((row) => row.id));
  if (ids.some((id) => !existing.has(id))) throw new TypeError("Provider connection not found");
  db.run("DELETE FROM apiKeyProviderConnections WHERE apiKeyId = ?", [apiKeyId]);
  for (const connectionId of ids) {
    db.run("INSERT INTO apiKeyProviderConnections(apiKeyId, connectionId) VALUES(?, ?)", [apiKeyId, connectionId]);
  }
}

/**
 * Replace a key's group membership inside the CALLER's transaction.
 *
 * Mirrors replaceProviderConnectionScopeInTx so a key update and its group
 * assignment commit or roll back together. Doing the membership write in a
 * separate transaction would leave a window where the scalar edits landed and
 * the groups did not.
 */
function replaceApiKeyGroupsInTx(db, apiKeyId, groupIds) {
  if (!Array.isArray(groupIds)) throw new TypeError("groupIds must be an array");
  const ids = groupIds.map((id) => {
    if (!isString(id) || !id.trim()) throw new TypeError("groupIds entries must be non-empty strings");
    return id.trim();
  });
  const unique = [...new Set(ids)];
  const existing = new Set(db.all("SELECT id FROM apiKeyGroups").map((row) => row.id));
  const unknown = unique.filter((id) => !existing.has(id));
  if (unknown.length) throw new TypeError(`Unknown group id(s): ${unknown.join(", ")}`);
  db.run("DELETE FROM apiKeyGroupMembers WHERE apiKeyId = ?", [apiKeyId]);
  const now = new Date().toISOString();
  for (const groupId of unique) {
    db.run(
      "INSERT OR IGNORE INTO apiKeyGroupMembers(groupId, apiKeyId, createdAt) VALUES(?, ?, ?)",
      [groupId, apiKeyId, now]
    );
  }
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
  const combos = validateAllowedCombos(allowedCombos == null ? [] : allowedCombos);
  const options = isNumber(optionsOrNow) ? { now: optionsOrNow } : optionsOrNow || {};
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
    allowedCombos: combos,
    dailyLimitTokens: tokenLimit ?? null,
    policy,
    expiresAt: expiry,
    isAdmin: options.isAdmin === true,
    createdAt: new Date(Number(now)).toISOString()
  };
  db.transaction(() => {
    db.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, isAdmin, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, JSON.stringify(apiKey.allowedCombos), apiKey.dailyLimitTokens, policy == null ? null : JSON.stringify(policy), apiKey.expiresAt, apiKey.isAdmin ? 1 : 0, apiKey.createdAt]
    );
    if (Object.hasOwn(options, "providerConnectionIds")) {
      replaceProviderConnectionScopeInTx(db, apiKey.id, options.providerConnectionIds);
    }
  });
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
    if (Object.hasOwn(data, "isActive")) {
      if (!isBoolean(data.isActive)) throw new TypeError("isActive must be a boolean");
      merged.isActive = data.isActive;
    }
    if (Object.hasOwn(data, "allowedCombos")) merged.allowedCombos = validateAllowedCombos(data.allowedCombos);
    if (Object.hasOwn(data, "dailyLimitTokens")) merged.dailyLimitTokens = normalizeDailyLimitTokens(data.dailyLimitTokens);
    if (Object.hasOwn(data, "expiresAt")) merged.expiresAt = normalizeApiKeyExpiresAt(data.expiresAt, now);
    if (Object.hasOwn(data, "isAdmin")) merged.isAdmin = data.isAdmin === true;
    const updatesPolicy = Object.hasOwn(data, "policy") || Object.hasOwn(data, "policyPatch");
    if (Object.hasOwn(data, "policy")) merged.policy = normalizeApiKeyPolicy(data.policy);
    if (Object.hasOwn(data, "policyPatch")) merged.policy = mergeApiKeyPolicy(merged.policy, data.policyPatch);
    const policyStorage = updatesPolicy ?
    merged.policy == null ? null : JSON.stringify(merged.policy) :
    row.policy;
    if (Object.hasOwn(data, "providerConnectionIds")) {
      replaceProviderConnectionScopeInTx(db, id, data.providerConnectionIds);
    }
    // Same transaction as the scalar update, so a failure cannot leave the key
    // edited but its groups unchanged (or vice versa).
    if (Object.hasOwn(data, "groupIds")) {
      replaceApiKeyGroupsInTx(db, id, data.groupIds);
    }
    db.run(
      `UPDATE apiKeys SET name = ?, isActive = ?, allowedCombos = ?, dailyLimitTokens = ?, policy = ?, expiresAt = ?, isAdmin = ? WHERE id = ?`,
      [merged.name, merged.isActive ? 1 : 0, JSON.stringify(merged.allowedCombos || []), merged.dailyLimitTokens ?? null, policyStorage, merged.expiresAt ?? null, merged.isAdmin ? 1 : 0, id]
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

export async function getApiKeyUsageLimitStatus(key, now = new Date(), apiKeyId = null) {
  if (!key && !apiKeyId) return { enforced: false, exceeded: false };
  const db = await getAdapter();
  // The admitted id resolves the key even when the secret it was admitted
  // with has since changed; the secret is the fallback for callers that do
  // not carry one.
  const row = apiKeyId
    ? db.get(`SELECT id, isActive, dailyLimitTokens, expiresAt FROM apiKeys WHERE id = ?`, [apiKeyId])
    : db.get(`SELECT id, isActive, dailyLimitTokens, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true) || isApiKeyExpired(row.expiresAt, now.getTime())) return { enforced: false, exceeded: false };
  const limit = normalizeDailyLimitTokens(row.dailyLimitTokens);
  if (limit === null || limit === undefined) return { enforced: false, exceeded: false };
  const start = getLocalDayStartIso(now);
  // The daily allowance belongs to the key, not to the secret it stores: rows
  // carrying the stable id count directly, legacy rows keep their existing
  // scoped association through the secret. The branches are disjoint, so a row
  // is never counted twice.
  const scope = apiKeyUsageScope(db, { apiKeyId: row.id, apiKey: key });
  const usedTokens = db.all(
    `SELECT promptTokens, completionTokens, tokens FROM usageHistory WHERE ${scope.clause} AND timestamp >= ?`,
    [...scope.params, start]
  ).reduce((total, usage) => {
    let tokens = {};
    try {tokens = usage.tokens ? JSON.parse(usage.tokens) : {};} catch {tokens = {};}
    return total + getCommittedTokenCount(tokens, usage);
  }, 0);
  return {
    enforced: true,
    exceeded: usedTokens >= limit,
    usedTokens,
    limitTokens: limit,
    remainingTokens: Math.max(0, limit - usedTokens),
    resetAt: new Date(new Date(now).setHours(24, 0, 0, 0)).toISOString()
  };
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Replace a key's secret with a freshly generated one.
 *
 * The row is the account; the secret is only the credential that opens it. A
 * rotation therefore swaps the credential and nothing else: the id, name,
 * admin scope, policy, quota, groups, provider connections, expiry and history
 * stay on the same row, so the key keeps its budgets and its usage totals
 * instead of opening a second account under a new secret.
 *
 * The swap is conditional on the secret this call read, so two rotations that
 * race cannot both report a result: the loser changes no row and is told the
 * key was rotated elsewhere. Handing out a secret that was never installed
 * would be worse than the conflict.
 *
 * The retired secret is not written anywhere. It stops validating the moment
 * the update commits, and no ledger, archive or cache keeps a copy of it.
 *
 * @param {string} id - the key's stable row id
 * @param {string} machineId - the server's machine id, the source of the new secret
 * @returns {Promise<{status: "rotated", key: object} | {status: "not_found"} | {status: "conflict"}>}
 */
export async function rotateApiKey(id, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  let outcome = null;
  db.transaction(() => {
    const row = db.get(`SELECT key FROM apiKeys WHERE id = ?`, [id]);
    if (!row) {
      outcome = { status: "not_found" };
      return;
    }
    // A rotation has to change the credential. A generator that repeated the
    // current secret would leave the retired one working, so the candidate is
    // regenerated until it differs.
    let candidate = generateApiKeyWithMachine(machineId).key;
    for (let attempt = 0; attempt < 5 && candidate === row.key; attempt += 1) {
      candidate = generateApiKeyWithMachine(machineId).key;
    }
    if (candidate === row.key) throw new Error("Could not generate a new API key secret");
    const updated = db.run(
      `UPDATE apiKeys SET key = ?, machineId = ? WHERE id = ? AND key = ?`,
      [candidate, machineId, id, row.key]
    );
    if ((updated?.changes ?? 0) === 0) {
      outcome = { status: "conflict" };
      return;
    }
    outcome = { status: "rotated", key: rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id])) };
  });
  return outcome;
}
