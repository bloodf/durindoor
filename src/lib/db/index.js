// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { normalizeApiKeyPolicy } from "./helpers/apiKeyPolicy.js";
import { canonicalizeApiKeyExpiresAt } from "@/shared/utils/apiKeyExpiry";
import {
  canonicalizeQuotaNow,
  normalizeQuotaFetchState,
  normalizeQuotaSnapshot,
  quotaIdentityKey } from
"@/shared/utils/quotaSnapshot";
import {
  QUOTA_MAX_IMPORT_ROWS,
  QUOTA_MAX_SOURCE_SNAPSHOTS,
  QUOTA_PORTABLE_VERSION } from
"@/shared/constants/quota";
import { readQuotaPortableStateSync, writeQuotaPortableStateSync } from "./repos/quotaSnapshotsRepo.js";
import { assertNoActiveQuotaReservationsSync } from "./repos/quotaReservationsRepo.js";
import { SENSITIVE_CONNECTION_FIELDS } from "./repos/connectionsRepo.js";
import { isEncryptedBlob, decryptField, encryptField } from "../crypto/columnCrypto.js";
import { isBoolean, isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";
import { mergeProviderSpecificData } from "./helpers/mergeProviderMetadata.js";
import { validateComboInvariant } from "@/lib/combos/invariants.js";

function assertUniqueNonEmpty(rows, field, label, { revealDuplicate = true } = {}) {
  const seen = new Set();
  for (const row of rows) {
    const value = row?.[field];
    if (!isString(value) || !value.trim()) {
      throw new Error(`${label} ${field} must be a non-empty string`);
    }
    if (seen.has(value)) {
      throw new Error(revealDuplicate ?
      `Duplicate ${label} ${field}: ${value}` :
      `Duplicate ${label} ${field}`);
    }
    seen.add(value);
  }
  return seen;
}

function validateApiKeyImport(payload) {
  const apiKeys = payload.apiKeys ?? [];
  const totals = payload.apiKeyUsageTotals ?? [];
  if (!Array.isArray(apiKeys)) throw new Error("apiKeys must be an array");
  if (Object.hasOwn(payload, "apiKeyUsageTotals") && !Array.isArray(totals)) {
    throw new Error("apiKeyUsageTotals must be an array");
  }

  const ids = assertUniqueNonEmpty(apiKeys, "id", "API key");
  // API-key secrets must never be copied into an import error or route log.
  assertUniqueNonEmpty(apiKeys, "key", "API key", { revealDuplicate: false });
  const normalizedApiKeys = apiKeys.map((key) => {
    if (key.allowedCombos != null && (!Array.isArray(key.allowedCombos) || key.allowedCombos.some((combo) => !isString(combo)))) {
      throw new Error(`API key ${key.id} allowedCombos must be an array of strings`);
    }
    if (key.dailyLimitTokens != null) {
      const limit = Number(key.dailyLimitTokens);
      if (!Number.isSafeInteger(limit) || limit < 0) throw new Error(`API key ${key.id} dailyLimitTokens must be a non-negative integer`);
    }
    let expiresAt;
    try {
      expiresAt = canonicalizeApiKeyExpiresAt(key.expiresAt ?? null);
    } catch {
      throw new Error(`API key ${key.id} expiresAt must be an absolute ISO-8601 timestamp with a timezone or null`);
    }
    normalizeApiKeyPolicy(key.policy);
    return { ...key, expiresAt };
  });

  const totalIds = assertUniqueNonEmpty(totals, "apiKeyId", "API-key total");
  for (const total of totals) {
    if (!ids.has(total.apiKeyId)) throw new Error(`API-key total references missing key: ${total.apiKeyId}`);
    for (const field of ["totalTokens", "totalCost", "totalRequests"]) {
      const value = total[field];
      if (!isNumber(value) || !Number.isFinite(value) || value < 0 || field !== "totalCost" && !Number.isSafeInteger(value)) {
        throw new Error(`API-key total ${total.apiKeyId} ${field} is invalid`);
      }
    }
    if (total.updatedAt != null) {
      const updatedAt = total.updatedAt;
      const hasTimezone = isString(updatedAt) && /(Z|[+-]\d{2}:\d{2})$/i.test(updatedAt);
      if (!hasTimezone || !Number.isFinite(Date.parse(updatedAt))) {
        throw new Error(`API-key total ${total.apiKeyId} updatedAt is invalid`);
      }
    }
  }
  return { apiKeys: normalizedApiKeys, totals, totalIds };
}

function validateApiKeyProviderConnectionImport(payload, { apiKeyIds, providerConnectionIds }) {
  const rows = payload.apiKeyProviderConnections ?? [];
  if (!Array.isArray(rows)) throw new Error("apiKeyProviderConnections must be an array");
  const seen = new Set();
  const normalized = [];
  for (const [index, row] of rows.entries()) {
    if (!isObject(row) || Array.isArray(row)) {
      throw new Error(`apiKeyProviderConnections[${index}] must be an object`);
    }
    const { apiKeyId, connectionId } = row;
    if (!isString(apiKeyId) || !apiKeyId.trim()) {
      throw new Error(`apiKeyProviderConnections[${index}] apiKeyId must be a non-empty string`);
    }
    if (!isString(connectionId) || !connectionId.trim()) {
      throw new Error(`apiKeyProviderConnections[${index}] connectionId must be a non-empty string`);
    }
    const pair = `${apiKeyId}\u0000${connectionId}`;
    if (seen.has(pair)) {
      throw new Error(`Duplicate apiKeyProviderConnections pair: ${apiKeyId}/${connectionId}`);
    }
    seen.add(pair);
    if (!apiKeyIds.has(apiKeyId)) {
      throw new Error(`apiKeyProviderConnections[${index}] references missing API key: ${apiKeyId}`);
    }
    if (!providerConnectionIds.has(connectionId)) {
      throw new Error(`apiKeyProviderConnections[${index}] references missing provider connection: ${connectionId}`);
    }
    normalized.push({ apiKeyId, connectionId });
  }
  return normalized;
}

function validateQuotaImport(payload, { now }) {
  if (!Object.hasOwn(payload, "quota")) {
    return { present: false, quota: { version: QUOTA_PORTABLE_VERSION, snapshots: [], fetchStates: [] } };
  }
  const quota = payload.quota;
  if (!quota || !isObject(quota) || Array.isArray(quota)) throw new Error("quota must be an object");
  const allowedKeys = new Set(["version", "snapshots", "fetchStates"]);
  for (const key of Object.keys(quota)) {
    if (!allowedKeys.has(key)) throw new Error("quota contains an unsupported field");
  }
  if (quota.version !== QUOTA_PORTABLE_VERSION) throw new Error("Unsupported quota payload version");
  if (!Array.isArray(quota.snapshots)) throw new Error("quota.snapshots must be an array");
  if (!Array.isArray(quota.fetchStates)) throw new Error("quota.fetchStates must be an array");
  if (quota.snapshots.length + quota.fetchStates.length > QUOTA_MAX_IMPORT_ROWS) {
    throw new Error(`quota payload exceeds the ${QUOTA_MAX_IMPORT_ROWS}-row safety limit`);
  }
  const rawSourceCounts = new Map();
  for (const snapshot of quota.snapshots) {
    const connectionId = snapshot?.identity?.connectionId;
    const sourceId = snapshot?.provenance?.sourceId;
    if (!isString(connectionId) || !isString(sourceId)) continue;
    const key = JSON.stringify([connectionId, sourceId]);
    const count = (rawSourceCounts.get(key) || 0) + 1;
    if (count > QUOTA_MAX_SOURCE_SNAPSHOTS) throw new Error("quota payload exceeds the per-source row safety limit");
    rawSourceCounts.set(key, count);
  }

  const connections = payload.providerConnections ?? [];
  if (!Array.isArray(connections)) throw new Error("providerConnections must be an array");
  const connectionProviders = new Map();
  for (const [index, connection] of connections.entries()) {
    if (!isString(connection?.id) || !connection.id.trim()) throw new Error(`Provider connection at index ${index} must have an id`);
    if (!isString(connection?.provider) || !connection.provider.trim()) throw new Error(`Provider connection at index ${index} must have a provider`);
    if (connectionProviders.has(connection.id)) throw new Error(`Duplicate provider connection at index ${index}`);
    connectionProviders.set(connection.id, connection.provider);
  }

  const snapshots = quota.snapshots.map((snapshot, index) => {
    try {
      return normalizeQuotaSnapshot(snapshot, { allowCanonicalSentinels: true, now });
    } catch (error) {
      throw new Error(`quota.snapshots[${index}] is invalid: ${error.message}`);
    }
  });
  const snapshotKeys = new Set();
  for (const [index, snapshot] of snapshots.entries()) {
    const provider = connectionProviders.get(snapshot.identity.connectionId);
    if (!provider) throw new Error(`Quota snapshot at index ${index} references a missing provider connection`);
    if (provider !== snapshot.identity.provider) throw new Error(`Quota snapshot at index ${index} has a provider mismatch`);
    const key = quotaIdentityKey(snapshot.identity);
    if (snapshotKeys.has(key)) throw new Error("Duplicate quota snapshot identity");
    snapshotKeys.add(key);
  }

  const fetchStates = quota.fetchStates.map((state, index) => {
    try {
      return normalizeQuotaFetchState(state, { now });
    } catch (error) {
      throw new Error(`quota.fetchStates[${index}] is invalid: ${error.message}`);
    }
  });
  const fetchKeys = new Set();
  const fetchBySource = new Map();
  for (const [index, state] of fetchStates.entries()) {
    const provider = connectionProviders.get(state.connectionId);
    if (!provider) throw new Error(`Quota fetch state at index ${index} references a missing provider connection`);
    if (provider !== state.provider) throw new Error(`Quota fetch state at index ${index} has a provider mismatch`);
    const key = JSON.stringify([state.connectionId, state.sourceId]);
    if (fetchKeys.has(key)) throw new Error("Duplicate quota fetch-state identity");
    fetchKeys.add(key);
    fetchBySource.set(key, state);
  }
  for (const [index, snapshot] of snapshots.entries()) {
    const key = JSON.stringify([snapshot.identity.connectionId, snapshot.provenance.sourceId]);
    const fetchState = fetchBySource.get(key);
    if (!fetchState?.lastObservedAt || fetchState.lastObservedAt !== snapshot.timing.observedAt) {
      throw new Error(`Quota snapshot at index ${index} does not match its source watermark`);
    }
  }

  return { present: true, quota: { version: QUOTA_PORTABLE_VERSION, snapshots, fetchStates } };
}

// Settings
export {
  getSettings, getSettingsSync, updateSettings, updateSettingsWithPasswordEpoch, PasswordEpochMismatchError, isCloudEnabled, getCloudUrl, exportSettings } from
"./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  recordProviderConnectionFallbackState, clearProviderConnectionFallbackState,
  deleteProviderConnection, deleteProviderConnectionsByProvider, setProviderConnectionAutoPing,
  reorderProviderConnections, reorderProviderConnectionsByIds, cleanupProviderConnections } from
"./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode } from
"./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool } from
"./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey, getApiKeyUsageLimitStatus } from
"./repos/apiKeysRepo.js";
export { getApiKeyProviderConnectionIds, setApiKeyProviderConnectionIds } from
"./repos/apiKeyProviderConnectionsRepo.js";
export {
  getApiKeyUsageTotals, getAllApiKeyUsageTotals, incrementApiKeyUsageSync } from
"./repos/apiKeyUsageTotalsRepo.js";

// Provider-reported quota snapshots (runtime-neutral persistence boundary)
export {
  upsertProviderQuotaSnapshot, replaceProviderQuotaSnapshotsForSource,
  recordQuotaFetchFailure, getProviderQuotaSnapshot,
  listProviderQuotaSnapshots, getQuotaFetchState,
  pruneProviderQuotaSnapshots } from
"./repos/quotaSnapshotsRepo.js";

// Local operational quota reservations. These rows are deliberately excluded
// from portable export/import because they describe one running process epoch.
export {
  acquireQuotaReservation, markQuotaReservationDispatched,
  heartbeatQuotaReservation, commitQuotaReservation, releaseQuotaReservation,
  reapExpiredQuotaReservations, getQuotaReservationPressure,
  hasActiveDispatchedQuotaReservations, hashQuotaRoute,
  assertNoActiveQuotaReservationsSync,
  QuotaReservationError, QuotaCapacityUnavailableError } from
"./repos/quotaReservationsRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName, getComboForModel,
  createCombo, updateCombo, deleteCombo } from
"./repos/combosRepo.js";

// MCP gateway: upstream instances, gateway API keys, per-key grants
export {
  getInstances, getInstanceById, getInstanceBySlug, getEnabledInstancesByIds,
  createInstance, updateInstance, deleteInstance } from
"./repos/mcpInstancesRepo.js";
export {
  getGatewayKeys, getGatewayKeyById, createGatewayKey, deleteGatewayKey,
  validateGatewayKey, getGrantsForKey, getGrantsForKeyDetailed, setGrants } from
"./repos/mcpGatewayRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, updateCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll } from
"./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing } from
"./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels } from
"./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, finishPendingRequest, finishActiveSession, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  recordTokenSaverEvent, getTokenSaverStats,
  resetUsageHistory } from
"./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders } from
"./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb({ now = Date.now(), includeSecrets = false } = {}) {
  const db = await getAdapter();
  const quotaNow = canonicalizeQuotaNow(now).timestamp;
  return db.transaction(() => {
    const settingsRow = db.get(`SELECT data FROM settings WHERE id = 1`);
    const out = {
      settings: settingsRow ? parseJson(settingsRow.data, {}) : {},
      providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => {
        const conn = { ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt };
        if (!includeSecrets) {
          // SEC-B-02: scrub plaintext credentials from portable backups unless
          // explicitly opted-in. Encrypted blobs pass through but are still
          // scrubbed here — backups must never contain either form by default.
          for (const field of SENSITIVE_CONNECTION_FIELDS) delete conn[field];
        } else {
          // Opt-in mode: decrypt to plaintext so a backup can be re-imported
          // into a different DATA_DIR (which has a different master key).
          for (const field of SENSITIVE_CONNECTION_FIELDS) {
            const value = conn[field];
            if (isEncryptedBlob(value)) conn[field] = decryptField(value, r.id);
          }
        }
        return conn;
      }),
      providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => {
        let ac = [];
        try {ac = JSON.parse(r.allowedCombos);if (!Array.isArray(ac)) ac = [];} catch {}
        let policy = null;
        if (r.policy != null) {
          try {
            policy = normalizeApiKeyPolicy(JSON.parse(r.policy));
          } catch {
            // Never turn corrupt policy storage into an unrestricted backup.
            // The error names only the non-secret row ID.
            throw new Error(`API key ${r.id} has invalid policy JSON`);
          }
        }
        let expiresAt;
        try {
          expiresAt = canonicalizeApiKeyExpiresAt(r.expiresAt ?? null);
        } catch {
          throw new Error(`API key ${r.id} has invalid expiresAt storage`);
        }
        return { id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, allowedCombos: ac, dailyLimitTokens: r.dailyLimitTokens ?? null, policy, expiresAt, createdAt: r.createdAt };
      }),
      apiKeyProviderConnections: db.all(
        `SELECT apiKeyId, connectionId FROM apiKeyProviderConnections ORDER BY apiKeyId ASC, connectionId ASC`
      ),
      apiKeyUsageTotals: db.all(`SELECT * FROM apiKeyUsageTotals`).map((r) => ({
        apiKeyId: r.apiKeyId,
        totalTokens: Number(r.totalTokens) || 0,
        totalCost: Number(r.totalCost) || 0,
        totalRequests: Number(r.totalRequests) || 0,
        updatedAt: r.updatedAt || null
      })),
      quota: readQuotaPortableStateSync(db, { now: quotaNow }),
      combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
      modelAliases: {},
      customModels: [],
      mitmAlias: {},
      pricing: {}
    };

    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

    return out;
  });
}

export async function importDb(payload, { now = Date.now() } = {}) {
  if (!payload || !isObject(payload) || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  // Validate before opening the transaction or deleting any existing rows.
  // This makes duplicate keys, dangling totals, and malformed policies a hard
  // import error instead of silently collapsing or weakening enforcement.
  const { apiKeys, totals } = validateApiKeyImport(payload);
  const quotaNow = canonicalizeQuotaNow(now).timestamp;
  const { quota } = validateQuotaImport(payload, { now: quotaNow });
  const apiKeyProviderConnections = validateApiKeyProviderConnectionImport(payload, {
    apiKeyIds: new Set(apiKeys.map((key) => key.id)),
    providerConnectionIds: new Set((payload.providerConnections ?? []).map((connection) => connection.id)),
  });
  const db = await getAdapter();

  db.transaction(() => {
    // Acquire SQLite's writer lock and recheck inside the destructive
    // transaction so another process cannot reserve between guard and wipe.
    assertNoActiveQuotaReservationsSync(db, { now: quotaNow });
    // Wipe all tables (keep _meta)
    // Usage history is intentionally retained for operator analytics, but its
    // literal-secret attribution belongs to the pre-import key set. Detach it
    // so an imported key reusing the same secret cannot inherit daily limits.
    db.run(`UPDATE usageHistory SET apiKey = NULL WHERE apiKey IS NOT NULL`);
    for (const row of db.all(`SELECT dateKey, data FROM usageDaily`)) {
      const day = parseJson(row.data, {});
      if (day?.byApiKey && Object.keys(day.byApiKey).length > 0) {
        // Preserve aggregate/provider/model analytics while removing the
        // secret-derived per-key buckets from the pre-import identity set.
        day.byApiKey = {};
        db.run(`UPDATE usageDaily SET data = ? WHERE dateKey = ?`, [stringifyJson(day), row.dateKey]);
      }
    }
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM quotaReservationItems`);
    db.run(`DELETE FROM quotaReservations`);
    db.run(`DELETE FROM quotaFetchStates`);
    db.run(`DELETE FROM providerQuotaSnapshots`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeyUsageTotals`);
    db.run(`DELETE FROM apiKeyProviderConnections`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      for (const field of SENSITIVE_CONNECTION_FIELDS) {
        const value = rest[field];
        if (isString(value) && value.length > 0 && !isEncryptedBlob(value)) {
          rest[field] = encryptField(value, id);
        }
      }
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    writeQuotaPortableStateSync(db, quota);
    for (const k of apiKeys) {
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, JSON.stringify(k.allowedCombos || []), k.dailyLimitTokens ?? null, k.policy == null ? null : stringifyJson(normalizeApiKeyPolicy(k.policy)), k.expiresAt || null, k.createdAt || new Date().toISOString()]
      );
    }
    for (const relation of apiKeyProviderConnections) {
      db.run(
        `INSERT INTO apiKeyProviderConnections(apiKeyId, connectionId) VALUES(?, ?)`,
        [relation.apiKeyId, relation.connectionId]
      );
    }
    if (Object.hasOwn(payload, "apiKeyUsageTotals")) {
      for (const total of totals) {
        if (!total?.apiKeyId) continue;
        db.run(
          `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
          [total.apiKeyId, Number(total.totalTokens) || 0, Number(total.totalCost) || 0, Number(total.totalRequests) || 0, total.updatedAt || null]
        );
      }
    } else {
      // Full backups created before durable totals cannot prove historical
      // usage. The import intentionally clears local history attribution and
      // starts each imported key at zero rather than attaching unrelated rows
      // that happen to reuse the same literal secret.
      for (const key of apiKeys) {
        db.run(
          `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, 0, 0, 0, NULL)`,
          [key.id]
        );
      }
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb({ now: quotaNow });
}
const TRANSFER_CONNECTION_FIELDS = new Set([
  "id", "provider", "authType", "name", "email", "priority", "isActive", "createdAt", "updatedAt",
  "displayName", "globalPriority", "defaultModel", "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount", "providerSpecificData", ...SENSITIVE_CONNECTION_FIELDS
]);
const TRANSFER_SAFE_PSD_FIELDS = new Set([
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId", "region", "projectId", "resourceUrl",
  "proxyPoolId", "cx", "connectionProxyEnabled", "connectionNoProxy", "githubLogin", "githubName", "githubEmail",
  "githubUserId", "username", "firstName", "lastName", "authMethod", "authKind", "profileArn",
  "codexFingerprintMode", "openaiStoreEnabled", "copilotTokenExpiresAt"
]);
const TRANSFER_BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TRANSFER_SECRET_LIKE_KEYS = new Set([
  "accessToken", "refreshToken", "apiKey", "idToken", "firecrawlHeaders",
  "refresh_token", "proxyPassword", "proxyUrl", "password", "secret", "clientSecret", "copilotToken", "cookie", "authorization"
]);

function isTransferObject(value) {
  return value && isObject(value) && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isTransferScalar(value) {
  return value === null || isString(value) || isNumber(value) || isBoolean(value);
}

function transferSafeUrl(value) {
  if (!isString(value) || !value) return value;
  let parsed;
  try { parsed = new URL(value); } catch { return value; }
  return parsed.username || parsed.password ? null : value;
}

function transferPublic(connection, { includeSecrets = false } = {}) {
  const out = {};
  for (const [key, value] of Object.entries(connection)) {
    if (!TRANSFER_CONNECTION_FIELDS.has(key) || TRANSFER_BLOCKED_KEYS.has(key)) continue;
    if (key === "providerSpecificData") {
      if (!isTransferObject(value)) continue;
      const psd = {};
      for (const [psdKey, psdValue] of Object.entries(value)) {
        // PSD has no at-rest crypto. Explicit exports therefore include only
        // top-level SENSITIVE_CONNECTION_FIELDS, which import encrypts.
        if (!TRANSFER_SAFE_PSD_FIELDS.has(psdKey) || TRANSFER_BLOCKED_KEYS.has(psdKey) || TRANSFER_SECRET_LIKE_KEYS.has(psdKey) || !isTransferScalar(psdValue)) continue;
        const safe = transferSafeUrl(psdValue);
        if (safe !== null) psd[psdKey] = safe;
      }
      out[key] = psd;
    } else if (includeSecrets || !SENSITIVE_CONNECTION_FIELDS.includes(key)) {
      const safe = transferSafeUrl(value);
      if (safe !== null) out[key] = safe;
    }
  }
  return out;
}

function validateTransferProvider(row) {
  if (!isTransferObject(row)) throw new Error("Provider transfer row is invalid");
  for (const key of Object.keys(row)) {
    if (TRANSFER_BLOCKED_KEYS.has(key) || !TRANSFER_CONNECTION_FIELDS.has(key)) throw new Error(`Provider transfer row has unsupported field: ${key}`);
  }
  if (!isString(row.provider) || !isString(row.authType)) throw new Error("Provider transfer row is incomplete");
  if (Object.hasOwn(row, "providerSpecificData")) {
    if (!isTransferObject(row.providerSpecificData)) throw new Error("Provider transfer providerSpecificData must be an object");
    for (const [key, value] of Object.entries(row.providerSpecificData)) {
      if (TRANSFER_BLOCKED_KEYS.has(key) || TRANSFER_SECRET_LIKE_KEYS.has(key) || !TRANSFER_SAFE_PSD_FIELDS.has(key) || !isTransferScalar(value) || transferSafeUrl(value) === null) throw new Error(`Provider transfer providerSpecificData has unsupported field: ${key}`);
    }
  }
}

function validateTransferSelection(selection) {
  if (!selection || !isObject(selection) || Array.isArray(selection)) throw new Error("Transfer selection is required");
  const ids = (key) => {
    const value = selection[key] ?? [];
    if (!Array.isArray(value) || value.some((id) => !isString(id) || !id.trim()) || new Set(value).size !== value.length) {
      throw new Error(`Transfer ${key} must be unique non-empty IDs`);
    }
    return value;
  };
  return { providers: ids("providers"), combos: ids("combos") };
}

/** Build a scoped portable bundle. Secrets require explicit route-level acknowledgement. */
export async function exportSelectiveDb(selection, { includeSecrets = false } = {}) {
  const { providers, combos } = validateTransferSelection(selection);
  const db = await getAdapter();
  return db.transaction(() => ({
    format: "durindoor-selective-transfer",
    version: 1,
    providerConnections: providers.length ? db.all(`SELECT * FROM providerConnections WHERE id IN (${providers.map(() => "?").join(",")})`, providers).map((row) => {
      const c = { ...parseJson(row.data, {}), id: row.id, provider: row.provider, authType: row.authType, name: row.name, email: row.email, priority: row.priority, isActive: row.isActive === 1, createdAt: row.createdAt, updatedAt: row.updatedAt };
      if (includeSecrets) for (const field of SENSITIVE_CONNECTION_FIELDS) if (isEncryptedBlob(c[field])) c[field] = decryptField(c[field], row.id);
      return transferPublic(c, { includeSecrets });
    }) : [],
    combos: combos.length ? db.all(`SELECT * FROM combos WHERE id IN (${combos.map(() => "?").join(",")})`, combos).map((row) => ({ id: row.id, name: row.name, kind: row.kind, models: parseJson(row.models, []), invariant: parseJson(row.invariant, null), createdAt: row.createdAt, updatedAt: row.updatedAt })) : []
  }));
}

export async function getSelectiveTransferCatalog() {
  const db = await getAdapter();
  return db.transaction(() => ({
    providers: db.all(`SELECT id, provider, name FROM providerConnections ORDER BY provider, name, id`).map((row) => ({ id: row.id, name: row.name || row.provider })),
    combos: db.all(`SELECT id, name FROM combos ORDER BY name, id`)
  }));
}

const TRANSFER_COMBO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

/** Validate complete bundle before one transaction; no-secret input preserves local credentials. */
export async function importSelectiveDb(bundle, selection) {
  const effectiveSelection = selection ?? {
    providers: Array.isArray(bundle?.providerConnections) ? bundle.providerConnections.map((row) => row?.id).filter(Boolean) : [],
    combos: Array.isArray(bundle?.combos) ? bundle.combos.map((row) => row?.id).filter(Boolean) : [],
  };
  if (!bundle || !isObject(bundle) || Array.isArray(bundle) || bundle.format !== "durindoor-selective-transfer" || bundle.version !== 1 || !Array.isArray(bundle.providerConnections) || !Array.isArray(bundle.combos)) throw new Error("Invalid selective transfer bundle");
  const selected = validateTransferSelection(effectiveSelection);
  const providerRows = bundle.providerConnections.filter((row) => selected.providers.includes(row?.id));
  const comboRows = bundle.combos.filter((row) => selected.combos.includes(row?.id));
  if (providerRows.length !== selected.providers.length || comboRows.length !== selected.combos.length) throw new Error("Transfer bundle does not contain every selected row");
  for (const row of [...providerRows, ...comboRows]) if (!row || !isObject(row) || !isString(row.id) || !row.id) throw new Error("Transfer row has invalid ID");
  if (new Set(providerRows.map((row) => row.id)).size !== providerRows.length || new Set(comboRows.map((row) => row.id)).size !== comboRows.length) throw new Error("Transfer bundle has duplicate IDs");
  for (const row of providerRows) validateTransferProvider(row);
  for (const row of comboRows) if (!isString(row.name) || !TRANSFER_COMBO_NAME_REGEX.test(row.name) || !Array.isArray(row.models)) throw new Error("Combo transfer row is incomplete or has an invalid name");
  if (new Set(comboRows.map((row) => row.name.toLowerCase())).size !== comboRows.length) throw new Error("Transfer bundle has duplicate combo names");
  const db = await getAdapter();

  // ---- Projection phase: all reads, remapping, and validation happen
  // before any write. A throw here leaves the database untouched. ----
  const usedNames = new Set(db.all(`SELECT name FROM combos`).map((row) => row.name.toLowerCase()));
  const comboNames = new Map();
  const comboIds = new Map();
  for (const row of comboRows) {
    const existing = db.get(`SELECT id, name FROM combos WHERE id = ?`, [row.id]);
    let name = row.name;
    if (usedNames.has(name.toLowerCase()) && !(existing && existing.name.toLowerCase() === name.toLowerCase())) {
      const suffixed = `${name}.imported-${row.id.slice(0, 8)}`;
      if (!TRANSFER_COMBO_NAME_REGEX.test(suffixed) || usedNames.has(suffixed.toLowerCase())) {
        throw new Error(`Transfer combo name "${row.name}" collides with an existing combo and cannot be remapped`);
      }
      name = suffixed;
    }
    usedNames.add(name.toLowerCase());
    comboIds.set(row.id, row.id);
    comboNames.set(row.name, name);
  }
  // A provider/combo row whose ID already exists locally is a same-instance
  // re-import: merge into the existing row (credential-preserving) instead
  // of cloning. Only a genuine ID COLLISION between two otherwise-unrelated
  // connections would need a fresh identity, and the fork's IDs are UUIDs,
  // so that case does not arise from real transfers.
  const remap = (value) => {
    if (Array.isArray(value)) return value.map(remap);
    if (!isTransferObject(value)) return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!TRANSFER_BLOCKED_KEYS.has(key)) out[key] = remap(item);
    if (out.kind === "combo-ref" && isString(out.model) && comboNames.has(out.model)) {
      out.model = comboNames.get(out.model);
    }
    if (isString(out.comboId) && comboIds.has(out.comboId)) out.comboId = comboIds.get(out.comboId);
    if (isString(out.comboName) && comboNames.has(out.comboName)) out.comboName = comboNames.get(out.comboName);
    return out;
  };

  const providerWrites = providerRows.map((incoming) => {
    const id = incoming.id;
    const existingRow = db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    const existingData = existingRow ? parseJson(existingRow.data, {}) : {};
    const { id: _id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...incomingData } = remap(incoming);
    const data = {
      ...incomingData,
      // Secret-free exports include only safe PSD metadata. Merge it via
      // the shared helper so nested OAuth/API credentials and arbitrary
      // unknown PSD sub-objects survive an import that did not carry them.
      providerSpecificData: mergeProviderSpecificData(existingData.providerSpecificData, incomingData.providerSpecificData),
    };
    for (const field of SENSITIVE_CONNECTION_FIELDS) {
      if (!Object.hasOwn(data, field)) {
        if (Object.hasOwn(existingData, field)) data[field] = existingData[field];
        continue;
      }
      const value = data[field];
      // A bundle-supplied credential is always plaintext explicit-secret
      // export data; an encrypted blob here can only be a cross-DATA_DIR
      // ciphertext whose AAD (source row id) no longer matches, so it must
      // be rejected rather than persisted as unreadable garbage.
      if (isEncryptedBlob(value)) throw new Error(`Transfer field "${field}" must not contain an encrypted credential blob`);
      if (isString(value) && value) data[field] = encryptField(value, id);
      else delete data[field];
    }
    return {
      id, provider, authType, name: name || null, email: email || null, priority: priority || null,
      isActive: isActive === false ? 0 : 1, data: stringifyJson(data),
      createdAt: existingRow?.createdAt || createdAt || new Date().toISOString(),
      updatedAt: updatedAt || new Date().toISOString(),
    };
  });

  const comboWrites = comboRows.map((source) => {
    const combo = remap(source);
    const id = comboIds.get(source.id);
    const name = comboNames.get(source.name);
    validateComboInvariant({ ...combo, name, invariant: combo.invariant });
    const existingRow = db.get(`SELECT createdAt FROM combos WHERE id = ?`, [id]);
    return {
      id, name, kind: combo.kind || null, models: stringifyJson(combo.models),
      invariant: combo.invariant ? stringifyJson(combo.invariant) : null,
      createdAt: existingRow?.createdAt || combo.createdAt || new Date().toISOString(),
      updatedAt: combo.updatedAt || new Date().toISOString(),
    };
  });

  const imported = { providers: [], combos: [] };
  db.transaction(() => {
    for (const w of providerWrites) {
      db.run(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, authType=excluded.authType, name=excluded.name, email=excluded.email, priority=excluded.priority, isActive=excluded.isActive, data=excluded.data, updatedAt=excluded.updatedAt`,
        [w.id, w.provider, w.authType, w.name, w.email, w.priority, w.isActive, w.data, w.createdAt, w.updatedAt]
      );
      imported.providers.push(w.id);
    }
    for (const w of comboWrites) {
      db.run(
        `INSERT INTO combos(id, name, kind, models, invariant, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, models=excluded.models, invariant=excluded.invariant, updatedAt=excluded.updatedAt`,
        [w.id, w.name, w.kind, w.models, w.invariant, w.createdAt, w.updatedAt]
      );
      imported.combos.push(w.id);
    }
  });
  return { imported };
}

/** Dry-run an import bundle: validate and project per-row conflicts without writing. */
export async function previewSelectiveImport(bundle, selection) {
  if (!bundle || !isObject(bundle) || Array.isArray(bundle) || bundle.format !== "durindoor-selective-transfer" || bundle.version !== 1 || !Array.isArray(bundle.providerConnections) || !Array.isArray(bundle.combos)) throw new Error("Invalid selective transfer bundle");
  const selected = validateTransferSelection(selection ?? {
    providers: bundle.providerConnections.map((row) => row?.id).filter(Boolean),
    combos: bundle.combos.map((row) => row?.id).filter(Boolean),
  });
  const providerRows = bundle.providerConnections.filter((row) => selected.providers.includes(row?.id));
  const comboRows = bundle.combos.filter((row) => selected.combos.includes(row?.id));
  if (providerRows.length !== selected.providers.length || comboRows.length !== selected.combos.length) throw new Error("Transfer bundle does not contain every selected row");
  for (const row of [...providerRows, ...comboRows]) if (!row || !isObject(row) || !isString(row.id) || !row.id) throw new Error("Transfer row has invalid ID");
  for (const row of providerRows) validateTransferProvider(row);
  for (const row of comboRows) if (!isString(row.name) || !TRANSFER_COMBO_NAME_REGEX.test(row.name) || !Array.isArray(row.models)) throw new Error("Combo transfer row is incomplete or has an invalid name");
  const db = await getAdapter();
  const providerConnections = providerRows.map((row) => {
    const existing = db.get(`SELECT id, provider, name FROM providerConnections WHERE id = ?`, [row.id]);
    return existing ? { id: row.id, action: "merge", currentName: existing.name, currentProvider: existing.provider, willKeepOmittedSecrets: true } : { id: row.id, action: "insert" };
  });
  const usedNames = new Set(db.all(`SELECT name FROM combos`).map((row) => row.name.toLowerCase()));
  const combos = comboRows.map((row) => {
    const existing = db.get(`SELECT id, name FROM combos WHERE id = ?`, [row.id]);
    if (existing) return { id: row.id, action: "merge", currentName: existing.name };
    const finalName = usedNames.has(row.name.toLowerCase()) ? `${row.name}.imported-${row.id.slice(0, 8)}` : row.name;
    if (!TRANSFER_COMBO_NAME_REGEX.test(finalName)) throw new Error("Transfer combo name cannot be remapped");
    return finalName === row.name ? { id: row.id, action: "insert", finalName } : { id: row.id, action: "rename", sourceName: row.name, finalName };
  });
  return { providerConnections, combos, secretsIncluded: false };
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}