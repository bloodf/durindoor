import { getAdapter } from "../driver.js";
import {
  QuotaSnapshotValidationError,
  canonicalizeQuotaNow,
  normalizeQuotaFetchState,
  normalizeQuotaIdentifier,
  normalizeQuotaIdentity,
  normalizeQuotaSourceId,
  normalizeQuotaSnapshot,
  quotaIdentityKey,
} from "../../../shared/utils/quotaSnapshot.js";
import {
  QUOTA_DEFAULT_RETENTION_MS,
  QUOTA_MAX_IMPORT_ROWS,
  QUOTA_MAX_SOURCE_SNAPSHOTS,
  QUOTA_PORTABLE_VERSION,
} from "../../../shared/constants/quota.js";

export const PROVIDER_QUOTA_SNAPSHOT_UPSERT_SQL = `
  INSERT INTO providerQuotaSnapshots(
    connectionId, accountKey, resourceKey, dimensionKey, state, limitKind,
    limitValue, usedValue, remainingValue, remainingRatio, unit, resetAt,
    cooldownUntil, observedAt, staleAt, sourceType, sourceId, reasonCode, metadataJson
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(connectionId, accountKey, resourceKey, dimensionKey) DO UPDATE SET
    state = excluded.state,
    limitKind = excluded.limitKind,
    limitValue = excluded.limitValue,
    usedValue = excluded.usedValue,
    remainingValue = excluded.remainingValue,
    remainingRatio = excluded.remainingRatio,
    unit = excluded.unit,
    resetAt = excluded.resetAt,
    cooldownUntil = excluded.cooldownUntil,
    observedAt = excluded.observedAt,
    staleAt = excluded.staleAt,
    sourceType = excluded.sourceType,
    sourceId = excluded.sourceId,
    reasonCode = excluded.reasonCode,
    metadataJson = excluded.metadataJson
  WHERE excluded.observedAt > providerQuotaSnapshots.observedAt
`;

const FETCH_STATE_INSERT_SQL = `
  INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, lastObservedAt, attemptedAt, retryAt, lastSuccessAt, reasonCode)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?)
`;

export const FETCH_SUCCESS_UPSERT_SQL = `
  INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, lastObservedAt, attemptedAt, retryAt, lastSuccessAt, reasonCode)
  VALUES(?, ?, 'success', ?, ?, NULL, ?, NULL)
  ON CONFLICT(connectionId, sourceId) DO UPDATE SET
    outcome = CASE
      WHEN excluded.attemptedAt >= quotaFetchStates.attemptedAt THEN 'success'
      ELSE quotaFetchStates.outcome
    END,
    lastObservedAt = CASE
      WHEN quotaFetchStates.lastObservedAt IS NULL OR excluded.lastObservedAt > quotaFetchStates.lastObservedAt
        THEN excluded.lastObservedAt
      ELSE quotaFetchStates.lastObservedAt
    END,
    attemptedAt = CASE
      WHEN excluded.attemptedAt > quotaFetchStates.attemptedAt THEN excluded.attemptedAt
      ELSE quotaFetchStates.attemptedAt
    END,
    retryAt = CASE
      WHEN excluded.attemptedAt >= quotaFetchStates.attemptedAt THEN NULL
      ELSE quotaFetchStates.retryAt
    END,
    lastSuccessAt = CASE
      WHEN quotaFetchStates.lastSuccessAt IS NULL OR excluded.lastSuccessAt > quotaFetchStates.lastSuccessAt
        THEN excluded.lastSuccessAt
      ELSE quotaFetchStates.lastSuccessAt
    END,
    reasonCode = CASE
      WHEN excluded.attemptedAt >= quotaFetchStates.attemptedAt THEN NULL
      ELSE quotaFetchStates.reasonCode
    END
`;

const FETCH_FAILURE_UPSERT_SQL = `
  INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, lastObservedAt, attemptedAt, retryAt, lastSuccessAt, reasonCode)
  VALUES(?, ?, ?, NULL, ?, ?, NULL, ?)
  ON CONFLICT(connectionId, sourceId) DO UPDATE SET
    outcome = excluded.outcome,
    attemptedAt = excluded.attemptedAt,
    retryAt = excluded.retryAt,
    lastSuccessAt = quotaFetchStates.lastSuccessAt,
    lastObservedAt = quotaFetchStates.lastObservedAt,
    reasonCode = excluded.reasonCode
  WHERE excluded.attemptedAt > quotaFetchStates.attemptedAt
`;

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new QuotaSnapshotValidationError(`${label} contains an unsupported field`);
  }
}

function assertConnectionProviderSync(db, connectionId, provider) {
  const connection = db.get(`SELECT provider FROM providerConnections WHERE id = ?`, [connectionId]);
  if (!connection) throw new QuotaSnapshotValidationError("Quota state references a missing provider connection");
  if (connection.provider !== provider) throw new QuotaSnapshotValidationError("Quota provider does not match the provider connection");
}

// Every quota write takes SQLite's writer lock before reading source state.
// This avoids a deferred-transaction WAL snapshot becoming stale while an
// independent process commits a competing replacement.
export const QUOTA_WRITE_LOCK_SQL = `UPDATE _meta SET value = value WHERE key = 'schemaVersion'`;

function acquireQuotaWriteLockSync(db) {
  const result = db.run(QUOTA_WRITE_LOCK_SQL);
  if ((result.changes || 0) !== 1) throw new Error("Quota persistence requires an initialized schema");
}

function readSourceStateSync(db, connectionId, sourceId) {
  const state = db.get(
    `SELECT lastObservedAt, attemptedAt FROM quotaFetchStates WHERE connectionId = ? AND sourceId = ?`,
    [connectionId, sourceId],
  ) ?? null;
  const rows = db.get(
    `SELECT COUNT(*) AS count, MIN(observedAt) AS minimum, MAX(observedAt) AS maximum
     FROM providerQuotaSnapshots WHERE connectionId = ? AND sourceId = ?`,
    [connectionId, sourceId],
  );
  const count = rows?.count ?? 0;
  if (count > QUOTA_MAX_SOURCE_SNAPSHOTS) {
    throw new QuotaSnapshotValidationError("Stored quota source exceeds its row limit");
  }
  if (count > 0 && (
    !state?.lastObservedAt
    || rows.minimum !== state.lastObservedAt
    || rows.maximum !== state.lastObservedAt
  )) {
    throw new QuotaSnapshotValidationError("Stored quota source does not match its observation watermark");
  }
  return state;
}

function snapshotParams(snapshot) {
  return [
    snapshot.identity.connectionId,
    snapshot.identity.accountKey,
    snapshot.identity.resourceKey,
    snapshot.identity.dimensionKey,
    snapshot.state,
    snapshot.amounts.limitKind,
    snapshot.amounts.limit,
    snapshot.amounts.used,
    snapshot.amounts.remaining,
    snapshot.amounts.remainingRatio,
    snapshot.amounts.unit,
    snapshot.timing.resetAt,
    snapshot.timing.cooldownUntil,
    snapshot.timing.observedAt,
    snapshot.timing.staleAt,
    snapshot.provenance.sourceType,
    snapshot.provenance.sourceId,
    snapshot.provenance.reasonCode,
    JSON.stringify(snapshot.provenance.metadata),
  ];
}

function insertSnapshotSync(db, snapshot) {
  return db.run(PROVIDER_QUOTA_SNAPSHOT_UPSERT_SQL, snapshotParams(snapshot));
}

function insertFetchStateSync(db, state) {
  return db.run(FETCH_STATE_INSERT_SQL, [
    state.connectionId,
    state.sourceId,
    state.outcome,
    state.lastObservedAt,
    state.attemptedAt,
    state.retryAt,
    state.lastSuccessAt,
    state.reasonCode,
  ]);
}

function upsertFetchSuccessSync(db, state) {
  return db.run(FETCH_SUCCESS_UPSERT_SQL, [
    state.connectionId,
    state.sourceId,
    state.lastObservedAt,
    state.attemptedAt,
    state.lastSuccessAt,
  ]);
}

function upsertFetchFailureSync(db, state) {
  return db.run(FETCH_FAILURE_UPSERT_SQL, [
    state.connectionId,
    state.sourceId,
    state.outcome,
    state.attemptedAt,
    state.retryAt,
    state.reasonCode,
  ]);
}

function rowToSnapshot(row, { now } = {}) {
  try {
    return normalizeQuotaSnapshot({
      identity: {
        connectionId: row.connectionId,
        provider: row.provider,
        accountKey: row.accountKey,
        resourceKey: row.resourceKey,
        dimensionKey: row.dimensionKey,
      },
      state: row.state,
      amounts: {
        limitKind: row.limitKind,
        limit: row.limitValue ?? null,
        used: row.usedValue ?? null,
        remaining: row.remainingValue ?? null,
        remainingRatio: row.remainingRatio ?? null,
        unit: row.unit ?? null,
      },
      timing: {
        resetAt: row.resetAt ?? null,
        cooldownUntil: row.cooldownUntil ?? null,
        observedAt: row.observedAt,
        staleAt: row.staleAt,
      },
      provenance: {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        reasonCode: row.reasonCode ?? null,
        metadata: JSON.parse(row.metadataJson),
      },
    }, { allowCanonicalSentinels: true, now });
  } catch {
    throw new Error("Stored quota snapshot is invalid");
  }
}

function rowToFetchState(row, { now } = {}) {
  try {
    return normalizeQuotaFetchState({
      connectionId: row.connectionId,
      provider: row.provider,
      sourceId: row.sourceId,
      outcome: row.outcome,
      lastObservedAt: row.lastObservedAt ?? null,
      attemptedAt: row.attemptedAt,
      retryAt: row.retryAt ?? null,
      lastSuccessAt: row.lastSuccessAt ?? null,
      reasonCode: row.reasonCode ?? null,
    }, { now });
  } catch {
    throw new Error("Stored quota fetch state is invalid");
  }
}

function snapshotSelect(where = "") {
  return `
    SELECT s.*, c.provider
    FROM providerQuotaSnapshots s
    JOIN providerConnections c ON c.id = s.connectionId
    ${where}
  `;
}

function fetchStateSelect(where = "") {
  return `
    SELECT f.*, c.provider
    FROM quotaFetchStates f
    JOIN providerConnections c ON c.id = f.connectionId
    ${where}
  `;
}

export async function upsertProviderQuotaSnapshot(value, { now = Date.now() } = {}) {
  const snapshot = normalizeQuotaSnapshot(value, { now });
  const fetchState = normalizeQuotaFetchState({
    connectionId: snapshot.identity.connectionId,
    provider: snapshot.identity.provider,
    sourceId: snapshot.provenance.sourceId,
    outcome: "success",
    lastObservedAt: snapshot.timing.observedAt,
    attemptedAt: snapshot.timing.observedAt,
  }, { now });
  const db = await getAdapter();
  let accepted = false;
  db.transaction(() => {
    acquireQuotaWriteLockSync(db);
    assertConnectionProviderSync(db, snapshot.identity.connectionId, snapshot.identity.provider);
    const stored = readSourceStateSync(db, snapshot.identity.connectionId, snapshot.provenance.sourceId);
    if (!stored?.lastObservedAt || snapshot.timing.observedAt > stored.lastObservedAt) {
      db.run(
        `DELETE FROM providerQuotaSnapshots WHERE connectionId = ? AND sourceId = ?`,
        [snapshot.identity.connectionId, snapshot.provenance.sourceId],
      );
      accepted = (insertSnapshotSync(db, snapshot).changes || 0) > 0;
    }
    upsertFetchSuccessSync(db, fetchState);
  });
  if (!accepted) return null;
  const row = db.get(snapshotSelect(`WHERE s.connectionId = ? AND s.accountKey = ? AND s.resourceKey = ? AND s.dimensionKey = ?`), [
    snapshot.identity.connectionId,
    snapshot.identity.accountKey,
    snapshot.identity.resourceKey,
    snapshot.identity.dimensionKey,
  ]);
  return rowToSnapshot(row, { now });
}

export async function replaceProviderQuotaSnapshotsForSource(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuotaSnapshotValidationError("Quota source replacement must be an object");
  rejectUnknownKeys(value, new Set(["connectionId", "provider", "sourceId", "observedAt", "snapshots", "fetchState"]), "quota source replacement");
  const connectionId = normalizeQuotaIdentifier(value.connectionId, "connectionId");
  const provider = normalizeQuotaIdentifier(value.provider, "provider");
  const sourceId = normalizeQuotaSourceId(value.sourceId, provider, "sourceId");
  const observedAt = canonicalizeQuotaNow(value.observedAt).value;
  if (!Array.isArray(value.snapshots)) throw new QuotaSnapshotValidationError("snapshots must be an array");
  if (value.snapshots.length > QUOTA_MAX_SOURCE_SNAPSHOTS) {
    throw new QuotaSnapshotValidationError(`snapshots exceeds the ${QUOTA_MAX_SOURCE_SNAPSHOTS}-row source limit`);
  }
  const snapshots = value.snapshots.map((snapshot) => normalizeQuotaSnapshot(snapshot, { now }));
  const seen = new Set();
  for (const snapshot of snapshots) {
    if (snapshot.identity.connectionId !== connectionId || snapshot.identity.provider !== provider) {
      throw new QuotaSnapshotValidationError("Every snapshot must match the replacement connection and provider");
    }
    if (snapshot.provenance.sourceId !== sourceId || snapshot.timing.observedAt !== observedAt) {
      throw new QuotaSnapshotValidationError("Every snapshot must match the replacement source and observation time");
    }
    const key = quotaIdentityKey(snapshot.identity);
    if (seen.has(key)) throw new QuotaSnapshotValidationError("Quota source replacement contains a duplicate snapshot identity");
    seen.add(key);
  }
  if (value.fetchState?.lastObservedAt != null && canonicalizeQuotaNow(value.fetchState.lastObservedAt).value !== observedAt) {
    throw new QuotaSnapshotValidationError("Fetch-state observation time must match the source observation");
  }
  const fetchState = normalizeQuotaFetchState({ ...value.fetchState, lastObservedAt: observedAt }, { now });
  if (fetchState.connectionId !== connectionId || fetchState.provider !== provider || fetchState.sourceId !== sourceId || fetchState.outcome !== "success") {
    throw new QuotaSnapshotValidationError("A source replacement requires a matching successful fetch state");
  }
  if (Date.parse(fetchState.attemptedAt) < Date.parse(observedAt)) {
    throw new QuotaSnapshotValidationError("Fetch attempt time must not precede the source observation");
  }

  const db = await getAdapter();
  db.transaction(() => {
    acquireQuotaWriteLockSync(db);
    assertConnectionProviderSync(db, connectionId, provider);
    const stored = readSourceStateSync(db, connectionId, sourceId);
    if (!stored?.lastObservedAt || observedAt > stored.lastObservedAt) {
      db.run(
        `DELETE FROM providerQuotaSnapshots WHERE connectionId = ? AND sourceId = ?`,
        [connectionId, sourceId],
      );
      for (const snapshot of snapshots) insertSnapshotSync(db, snapshot);
    }
    upsertFetchSuccessSync(db, fetchState);
    const storedSourceCount = db.get(
      `SELECT COUNT(*) AS count FROM providerQuotaSnapshots WHERE connectionId = ? AND sourceId = ?`,
      [connectionId, sourceId],
    )?.count ?? 0;
    if (storedSourceCount > QUOTA_MAX_SOURCE_SNAPSHOTS) {
      throw new QuotaSnapshotValidationError("Stored quota source exceeds its row limit");
    }
  });
  return listProviderQuotaSnapshots({ connectionId, provider, includeStale: true, now });
}

export async function recordQuotaFetchFailure(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuotaSnapshotValidationError("Quota fetch failure must be an object");
  if (value.fetchState !== undefined) {
    rejectUnknownKeys(value, new Set(["connectionId", "provider", "sourceId", "fetchState"]), "quota fetch failure");
  }
  let candidate = value;
  if (value.fetchState !== undefined) {
    if (!value.fetchState || typeof value.fetchState !== "object" || Array.isArray(value.fetchState)) {
      throw new QuotaSnapshotValidationError("fetchState must be an object");
    }
    for (const field of ["connectionId", "provider", "sourceId"]) {
      if (value.fetchState[field] !== undefined && value[field] !== undefined && value.fetchState[field] !== value[field]) {
        throw new QuotaSnapshotValidationError(`fetchState.${field} must match ${field}`);
      }
    }
    candidate = {
      ...value.fetchState,
      connectionId: value.fetchState.connectionId ?? value.connectionId,
      provider: value.fetchState.provider ?? value.provider,
      sourceId: value.fetchState.sourceId ?? value.sourceId,
    };
  }
  if (candidate.lastObservedAt != null || candidate.lastSuccessAt != null) {
    throw new QuotaSnapshotValidationError("Runtime quota fetch failures must not supply trusted success history");
  }
  const state = normalizeQuotaFetchState(candidate, { now });
  if (state.outcome === "success") throw new QuotaSnapshotValidationError("recordQuotaFetchFailure requires a non-success outcome");
  const db = await getAdapter();
  db.transaction(() => {
    acquireQuotaWriteLockSync(db);
    assertConnectionProviderSync(db, state.connectionId, state.provider);
    upsertFetchFailureSync(db, state);
  });
  return getQuotaFetchState({ connectionId: state.connectionId, provider: state.provider, sourceId: state.sourceId }, { now });
}

export async function getProviderQuotaSnapshot(value, { now = Date.now(), includeStale = false } = {}) {
  const identity = normalizeQuotaIdentity(value, { allowCanonicalSentinels: true });
  const clock = canonicalizeQuotaNow(now);
  const db = await getAdapter();
  assertConnectionProviderSync(db, identity.connectionId, identity.provider);
  const staleSql = includeStale ? "" : " AND s.staleAt > ?";
  const params = [identity.connectionId, identity.accountKey, identity.resourceKey, identity.dimensionKey, clock.value];
  if (!includeStale) params.push(clock.value);
  const row = db.get(snapshotSelect(`WHERE s.connectionId = ? AND s.accountKey = ? AND s.resourceKey = ? AND s.dimensionKey = ? AND s.observedAt <= ?${staleSql}`), params);
  return row ? rowToSnapshot(row, { now: clock.timestamp }) : null;
}

export async function listProviderQuotaSnapshots({ connectionId, provider, includeStale = false, now = Date.now() } = {}) {
  if (!connectionId && !provider) throw new QuotaSnapshotValidationError("A connectionId or provider filter is required");
  const normalizedConnection = connectionId == null ? null : normalizeQuotaIdentifier(connectionId, "connectionId");
  const normalizedProvider = provider == null ? null : normalizeQuotaIdentifier(provider, "provider");
  const clock = canonicalizeQuotaNow(now);
  const where = [];
  const params = [];
  if (normalizedConnection) { where.push("s.connectionId = ?"); params.push(normalizedConnection); }
  if (normalizedProvider) { where.push("c.provider = ?"); params.push(normalizedProvider); }
  where.push("s.observedAt <= ?"); params.push(clock.value);
  if (!includeStale) { where.push("s.staleAt > ?"); params.push(clock.value); }
  const db = await getAdapter();
  const rows = db.all(`${snapshotSelect(`WHERE ${where.join(" AND ")}`)} ORDER BY s.observedAt DESC, s.connectionId, s.accountKey, s.resourceKey, s.dimensionKey`, params);
  return rows.map((row) => rowToSnapshot(row, { now: clock.timestamp }));
}

export async function getQuotaFetchState({ connectionId, provider, sourceId }, { now = Date.now() } = {}) {
  const normalizedConnection = normalizeQuotaIdentifier(connectionId, "connectionId");
  const normalizedProvider = normalizeQuotaIdentifier(provider, "provider");
  const normalizedSource = normalizeQuotaSourceId(sourceId, normalizedProvider, "sourceId");
  const db = await getAdapter();
  assertConnectionProviderSync(db, normalizedConnection, normalizedProvider);
  const row = db.get(fetchStateSelect(`WHERE f.connectionId = ? AND f.sourceId = ?`), [normalizedConnection, normalizedSource]);
  return row ? rowToFetchState(row, { now }) : null;
}

/** Delete observations strictly older than the retention cutoff; the boundary remains. */
export async function pruneProviderQuotaSnapshots({ now = Date.now(), retentionMs = QUOTA_DEFAULT_RETENTION_MS } = {}) {
  const clock = canonicalizeQuotaNow(now);
  if (typeof retentionMs !== "number" || !Number.isSafeInteger(retentionMs) || retentionMs < 0) {
    throw new QuotaSnapshotValidationError("retentionMs must be a non-negative safe integer");
  }
  const cutoffTime = clock.timestamp - retentionMs;
  const cutoffDate = new Date(cutoffTime);
  if (!Number.isFinite(cutoffDate.getTime())) throw new QuotaSnapshotValidationError("retention cutoff is outside the supported timestamp range");
  const cutoff = cutoffDate.toISOString();
  const db = await getAdapter();
  return db.run(`DELETE FROM providerQuotaSnapshots WHERE staleAt < ?`, [cutoff]).changes || 0;
}

/** Synchronous helpers used only inside the full-database import transaction. */
export function assertQuotaForeignKeysSync(db) {
  const quotaTables = new Set(["providerquotasnapshots", "quotafetchstates"]);
  const violations = db.all(`PRAGMA foreign_key_check`)
    .filter((row) => quotaTables.has(String(row.table).toLowerCase()));
  if (violations.length > 0) throw new Error("Stored quota state has an invalid provider-connection reference");
}

export function assertQuotaSourceWatermarksSync(db) {
  const mismatch = db.get(`
    SELECT 1 AS present
    FROM providerQuotaSnapshots s
    LEFT JOIN quotaFetchStates f
      ON f.connectionId = s.connectionId AND f.sourceId = s.sourceId
    WHERE f.connectionId IS NULL
      OR f.lastObservedAt IS NULL
      OR f.lastObservedAt <> s.observedAt
    LIMIT 1
  `);
  if (mismatch) throw new Error("Stored quota snapshots do not match their source watermark");
}

export function readQuotaPortableStateSync(db, { now = Date.now() } = {}) {
  assertQuotaForeignKeysSync(db);
  assertQuotaSourceWatermarksSync(db);
  const snapshotCount = db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`)?.count ?? 0;
  const fetchStateCount = db.get(`SELECT COUNT(*) AS count FROM quotaFetchStates`)?.count ?? 0;
  if (snapshotCount + fetchStateCount > QUOTA_MAX_IMPORT_ROWS) {
    throw new Error("Stored quota state exceeds the portable row safety limit");
  }
  const oversizedSource = db.get(
    `SELECT 1 AS present FROM providerQuotaSnapshots
     GROUP BY connectionId, sourceId HAVING COUNT(*) > ? LIMIT 1`,
    [QUOTA_MAX_SOURCE_SNAPSHOTS],
  );
  if (oversizedSource) throw new Error("Stored quota source exceeds its row safety limit");
  const snapshots = db.all(`${snapshotSelect()} ORDER BY s.connectionId, s.accountKey, s.resourceKey, s.dimensionKey`)
    .map((row) => rowToSnapshot(row, { now }));
  const fetchStates = db.all(`${fetchStateSelect()} ORDER BY f.connectionId, f.sourceId`)
    .map((row) => rowToFetchState(row, { now }));
  return { version: QUOTA_PORTABLE_VERSION, snapshots, fetchStates };
}

export function writeQuotaPortableStateSync(db, quota) {
  for (const snapshot of quota.snapshots) {
    assertConnectionProviderSync(db, snapshot.identity.connectionId, snapshot.identity.provider);
    insertSnapshotSync(db, snapshot);
  }
  for (const state of quota.fetchStates) {
    assertConnectionProviderSync(db, state.connectionId, state.provider);
    insertFetchStateSync(db, state);
  }
}
