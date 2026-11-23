import crypto from "node:crypto";
import { QUOTA_WRITE_LOCK_SQL, QUOTA_WRITE_LOCK_SQL_PG } from "../db/repos/quotaSql.js";
import { tableColumnNames } from "../db/helpers/tableColumns.js";
import { isString } from "../../shared/utils/typeChecks.js";

export const ANTIGRAVITY_LEASE_MS = 60_000;
export const ANTIGRAVITY_MAX_PRE_DISPATCH_RETRIES = 5;
const BACKOFF_CAP_MS = 15 * 60 * 1000;

export function credentialRevision(refreshToken) {
  return crypto.createHash("sha256").update(String(refreshToken ?? ""), "utf8").digest("hex");
}

export function newLeaseOwner() {
  return `${process.pid}:${crypto.randomBytes(8).toString("hex")}:${crypto.randomUUID()}`;
}

export function antigravityLeaseTableReady(db) {
  try {
    return tableColumnNames(db, "antigravityRefreshLeases").has("connectionId");
  } catch {
    return false;
  }
}

function dbNow(db) {
  return db.driver === "pg"
    ? "(CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS BIGINT))"
    : "(CAST(strftime('%s','now') AS INTEGER) * 1000)";
}

function lockWriter(db) {
  if (db.driver === "pg") {
    if (!db.get(QUOTA_WRITE_LOCK_SQL_PG)) throw new Error("Antigravity lease requires an initialized schema");
    return;
  }
  const lock = db.run(QUOTA_WRITE_LOCK_SQL);
  if ((lock.changes || 0) !== 1) throw new Error("Antigravity lease requires an initialized schema");
}

function oneRow(result) {
  return (result?.changes || 0) === 1;
}

function backoffMs(retryCount, retryAfterMs) {
  const exp = Math.min(BACKOFF_CAP_MS, 1000 * (2 ** Math.min(retryCount, 10)));
  const jitter = crypto.randomInt(0, 30_001);
  const retryAfter = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
  return Math.max(exp + jitter, retryAfter);
}

export function observeExpiredAntigravityLeases(db) {
  if (!antigravityLeaseTableReady(db)) return 0;
  const now = dbNow(db);
  const result = db.run(
    `UPDATE antigravityRefreshLeases
     SET attemptState = 'uncertain', owner = NULL, fencingToken = NULL, leaseExpiresAt = NULL,
         errorCategory = 'uncertain_dispatch', updatedAt = ${now}
     WHERE attemptState = 'dispatched' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ${now}`
  );
  return result?.changes || 0;
}

export function seedAntigravityLease(db, connectionId, refreshToken, subject = null) {
  if (!antigravityLeaseTableReady(db) || !connectionId) return;
  const now = dbNow(db);
  db.run(
    `INSERT INTO antigravityRefreshLeases(
       connectionId, generation, attemptState, recoveryEnabled, retryCount, credentialRevision, subject, updatedAt
     ) VALUES (?, 1, 'idle', 0, 0, ?, ?, ${now})
     ON CONFLICT(connectionId) DO NOTHING`,
    [connectionId, refreshToken ? credentialRevision(refreshToken) : null, subject || null]
  );
}

export function advanceAntigravityGeneration(db, connectionId, refreshToken = null, subject = null) {
  if (!antigravityLeaseTableReady(db) || !connectionId) return false;
  const now = dbNow(db);
  const revision = refreshToken ? credentialRevision(refreshToken) : null;
  const updated = db.run(
    `UPDATE antigravityRefreshLeases
     SET generation = generation + 1, attemptState = 'idle', owner = NULL, fencingToken = NULL,
         leaseExpiresAt = NULL, attemptId = NULL, errorCategory = NULL, retryCount = 0, nextRetryAt = NULL,
         credentialRevision = COALESCE(?, credentialRevision), subject = COALESCE(?, subject), updatedAt = ${now}
     WHERE connectionId = ?`,
    [revision, subject || null, connectionId]
  );
  if (oneRow(updated)) return true;
  seedAntigravityLease(db, connectionId, refreshToken, subject);
  return false;
}

export function enableAntigravityRecovery(db, connectionId, subject) {
  if (!antigravityLeaseTableReady(db) || !connectionId) return { ok: false, category: "pre_dispatch_failure" };
  const existing = db.get(`SELECT subject FROM antigravityRefreshLeases WHERE connectionId = ?`, [connectionId]);
  const resolved = isString(subject) && subject ? subject : existing?.subject;
  if (!isString(resolved) || !resolved) return { ok: false, category: "reauth_required" };
  seedAntigravityLease(db, connectionId, null, resolved);
  const now = dbNow(db);
  const updated = db.run(
    `UPDATE antigravityRefreshLeases
     SET recoveryEnabled = 1, subject = ?, consentRecordedAt = ?, updatedAt = ${now}
     WHERE connectionId = ?`,
    [resolved, new Date().toISOString(), connectionId]
  );
  return oneRow(updated) ? { ok: true } : { ok: false, category: "pre_dispatch_failure" };
}

export function fenceAntigravityRecovery(db, connectionId, { deleteCredential = false } = {}) {
  if (!connectionId) return;
  const now = dbNow(db);
  if (antigravityLeaseTableReady(db)) {
    db.run(
      `UPDATE antigravityRefreshLeases
       SET generation = generation + 1, recoveryEnabled = 0, attemptState = 'idle', owner = NULL,
           fencingToken = NULL, leaseExpiresAt = NULL, attemptId = NULL, errorCategory = NULL,
           retryCount = 0, nextRetryAt = NULL, updatedAt = ${now}
       WHERE connectionId = ?`,
      [connectionId]
    );
  }
  if (deleteCredential && tableColumnNames(db, "antigravityRecoveryCredentials").has("connectionId")) {
    db.run(`DELETE FROM antigravityRecoveryCredentials WHERE connectionId = ?`, [connectionId]);
  }
}

export function deleteAntigravityRotationRows(db, connectionIds) {
  if (!connectionIds?.length) return;
  const placeholders = connectionIds.map(() => "?").join(", ");
  if (antigravityLeaseTableReady(db)) {
    db.run(`DELETE FROM antigravityRefreshLeases WHERE connectionId IN (${placeholders})`, connectionIds);
  }
  if (tableColumnNames(db, "antigravityRecoveryCredentials").has("connectionId")) {
    db.run(`DELETE FROM antigravityRecoveryCredentials WHERE connectionId IN (${placeholders})`, connectionIds);
  }
}

function blockCategory(row) {
  if (row.attemptState === "reauth" || row.errorCategory === "invalid_grant") return "reauth_required";
  if (row.errorCategory === "budget_exhausted") return "budget_exhausted";
  if (row.attemptState === "uncertain" || row.attemptState === "dispatched") return "uncertain_dispatch";
  return "busy";
}

export function acquireAntigravityLease(db, { connectionId, refreshToken, owner, force = false } = {}) {
  let outcome = { ok: false, category: "busy" };
  db.transaction(() => {
    lockWriter(db);
    const now = dbNow(db);
    observeExpiredAntigravityLeases(db);
    let row = db.get(`SELECT * FROM antigravityRefreshLeases WHERE connectionId = ?`, [connectionId]);
    if (!row) {
      seedAntigravityLease(db, connectionId, refreshToken, null);
      row = db.get(`SELECT * FROM antigravityRefreshLeases WHERE connectionId = ?`, [connectionId]);
    }
    if (!row) {
      outcome = { ok: false, category: "pre_dispatch_failure" };
      return;
    }
    if (row.attemptState === "dispatched") {
      db.run(
        `UPDATE antigravityRefreshLeases
         SET attemptState = 'uncertain', owner = NULL, fencingToken = NULL, leaseExpiresAt = NULL,
             errorCategory = 'uncertain_dispatch', updatedAt = ${now}
         WHERE connectionId = ? AND generation = ? AND attemptState = 'dispatched'
           AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= ${now}`,
        [connectionId, row.generation]
      );
      row = db.get(`SELECT * FROM antigravityRefreshLeases WHERE connectionId = ?`, [connectionId]);
    }
    if (row.attemptState === "uncertain" || row.attemptState === "reauth" || row.attemptState === "dispatched") {
      outcome = { ok: false, category: blockCategory(row), generation: row.generation };
      return;
    }
    if (!force && row.errorCategory === "budget_exhausted") {
      outcome = { ok: false, category: "budget_exhausted" };
      return;
    }
    if (!force && row.nextRetryAt) {
      const waiting = db.get(
        `SELECT 1 AS ready FROM antigravityRefreshLeases WHERE connectionId = ? AND nextRetryAt > ${now}`,
        [connectionId]
      );
      if (waiting) {
        outcome = { ok: false, category: row.errorCategory === "budget_exhausted" ? "budget_exhausted" : "rate_limit" };
        return;
      }
    }
    const claimedOpen = row.attemptState !== "claimed" || db.get(
      `SELECT 1 AS ready FROM antigravityRefreshLeases
       WHERE connectionId = ? AND generation = ? AND attemptState = 'claimed'
         AND (leaseExpiresAt IS NULL OR leaseExpiresAt <= ${now})`,
      [connectionId, row.generation]
    );
    if (!claimedOpen) {
      outcome = { ok: false, category: "busy" };
      return;
    }
    const fencingToken = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const revision = credentialRevision(refreshToken);
    const updated = db.run(
      `UPDATE antigravityRefreshLeases
       SET owner = ?, fencingToken = ?, leaseExpiresAt = ${now} + ?, attemptState = 'claimed',
           attemptId = ?, credentialRevision = ?, updatedAt = ${now}
       WHERE connectionId = ? AND generation = ? AND attemptState IN ('idle', 'claimed')
         AND (attemptState = 'idle' OR leaseExpiresAt IS NULL OR leaseExpiresAt <= ${now})`,
      [owner, fencingToken, ANTIGRAVITY_LEASE_MS, attemptId, revision, connectionId, row.generation]
    );
    if (!oneRow(updated)) {
      outcome = { ok: false, category: "busy" };
      return;
    }
    outcome = {
      ok: true,
      lease: {
        connectionId,
        generation: row.generation,
        owner,
        fencingToken,
        attemptId,
        credentialRevision: revision,
      },
    };
  });
  return outcome;
}

function fenceMatch(lease) {
  return [lease.connectionId, lease.generation, lease.owner, lease.fencingToken];
}

export function markAntigravityDispatched(db, lease) {
  const now = dbNow(db);
  return oneRow(db.run(
    `UPDATE antigravityRefreshLeases
     SET attemptState = 'dispatched', updatedAt = ${now}
     WHERE connectionId = ? AND generation = ? AND owner = ? AND fencingToken = ?
       AND attemptState = 'claimed' AND leaseExpiresAt > ${now}`,
    fenceMatch(lease)
  ));
}

export function renewAntigravityLease(db, lease) {
  const now = dbNow(db);
  return oneRow(db.run(
    `UPDATE antigravityRefreshLeases
     SET leaseExpiresAt = ${now} + ?, updatedAt = ${now}
     WHERE connectionId = ? AND generation = ? AND owner = ? AND fencingToken = ?
       AND attemptState IN ('claimed', 'dispatched') AND leaseExpiresAt > ${now}`,
    [ANTIGRAVITY_LEASE_MS, ...fenceMatch(lease)]
  ));
}

export function releaseAntigravityAttempt(db, lease, { category = "pre_dispatch_failure", retryAfterMs = 0, dispatched = false } = {}) {
  const now = dbNow(db);
  const row = db.get(
    `SELECT retryCount FROM antigravityRefreshLeases WHERE connectionId = ? AND generation = ?`,
    [lease.connectionId, lease.generation]
  );
  const retryCount = (row?.retryCount || 0) + 1;
  const exhausted = retryCount >= ANTIGRAVITY_MAX_PRE_DISPATCH_RETRIES;
  const errorCategory = exhausted ? "budget_exhausted" : category;
  const delay = exhausted ? null : backoffMs(retryCount, retryAfterMs);
  return oneRow(db.run(
    `UPDATE antigravityRefreshLeases
     SET attemptState = 'idle', owner = NULL, fencingToken = NULL, leaseExpiresAt = NULL, attemptId = NULL,
         retryCount = ?, nextRetryAt = CASE WHEN ? IS NULL THEN NULL ELSE ${now} + ? END,
         errorCategory = ?, updatedAt = ${now}
     WHERE connectionId = ? AND generation = ? AND owner = ? AND fencingToken = ?
       AND attemptState = ?`,
    [retryCount, delay, delay, errorCategory, ...fenceMatch(lease), dispatched ? "dispatched" : "claimed"]
  ));
}

export function markAntigravityUncertain(db, lease) {
  const now = dbNow(db);
  return oneRow(db.run(
    `UPDATE antigravityRefreshLeases
     SET attemptState = 'uncertain', owner = NULL, fencingToken = NULL, leaseExpiresAt = NULL,
         errorCategory = 'uncertain_dispatch', updatedAt = ${now}
     WHERE connectionId = ? AND generation = ? AND owner = ? AND fencingToken = ?
       AND attemptState = 'dispatched'`,
    fenceMatch(lease)
  ));
}

export function markAntigravityReauth(db, lease) {
  const now = dbNow(db);
  return oneRow(db.run(
    `UPDATE antigravityRefreshLeases
     SET attemptState = 'reauth', owner = NULL, fencingToken = NULL, leaseExpiresAt = NULL,
         errorCategory = 'invalid_grant', updatedAt = ${now}
     WHERE connectionId = ? AND generation = ? AND owner = ? AND fencingToken = ?
       AND attemptState = 'dispatched'`,
    fenceMatch(lease)
  ));
}

export function clearAntigravityLease(db, lease, refreshToken) {
  const now = dbNow(db);
  return oneRow(db.run(
    `UPDATE antigravityRefreshLeases
     SET attemptState = 'idle', owner = NULL, fencingToken = NULL, leaseExpiresAt = NULL, attemptId = NULL,
         errorCategory = NULL, retryCount = 0, nextRetryAt = NULL, credentialRevision = ?, updatedAt = ${now}
     WHERE connectionId = ? AND generation = ? AND owner = ? AND fencingToken = ?
       AND attemptState = 'dispatched' AND leaseExpiresAt > ${now}`,
    [credentialRevision(refreshToken), ...fenceMatch(lease)]
  ));
}

export function resetAntigravityRetryBudget(db, connectionId) {
  if (!antigravityLeaseTableReady(db)) return { ok: false, category: "pre_dispatch_failure" };
  const now = dbNow(db);
  const updated = db.run(
    `UPDATE antigravityRefreshLeases
     SET retryCount = 0, nextRetryAt = NULL, errorCategory = NULL, updatedAt = ${now}
     WHERE connectionId = ? AND attemptState = 'idle'`,
    [connectionId]
  );
  if (oneRow(updated)) return { ok: true };
  const row = db.get(`SELECT attemptState FROM antigravityRefreshLeases WHERE connectionId = ?`, [connectionId]);
  if (!row) return { ok: false, category: "pre_dispatch_failure" };
  if (row.attemptState === "uncertain" || row.attemptState === "dispatched") return { ok: false, category: "uncertain_dispatch" };
  if (row.attemptState === "reauth") return { ok: false, category: "reauth_required" };
  return { ok: false, category: "busy" };
}

export function readAntigravityLeaseStatus(db, connectionId) {
  if (!antigravityLeaseTableReady(db)) return null;
  const row = db.get(
    `SELECT attemptState, errorCategory, recoveryEnabled, retryCount, nextRetryAt, subject, generation
     FROM antigravityRefreshLeases WHERE connectionId = ?`,
    [connectionId]
  );
  if (!row) return null;
  return {
    attemptState: row.attemptState,
    errorCategory: row.errorCategory || null,
    recoveryEnabled: row.recoveryEnabled === 1,
    retryCount: row.retryCount || 0,
    nextRetryAt: row.nextRetryAt || null,
    subjectPresent: Boolean(row.subject),
    generation: row.generation,
  };
}

export function noteImportedAntigravityToken(db, { connectionId, provider, refreshToken }) {
  if (provider !== "antigravity" && provider !== "agy") return;
  if (!antigravityLeaseTableReady(db) || !connectionId) return;
  if (!isString(refreshToken) || !refreshToken) return;
  const row = db.get(
    `SELECT credentialRevision, attemptState FROM antigravityRefreshLeases WHERE connectionId = ?`,
    [connectionId]
  );
  const revision = credentialRevision(refreshToken);
  if (row && row.credentialRevision === revision) return;
  advanceAntigravityGeneration(db, connectionId, refreshToken, null);
}

export function dropAntigravityRowsForMissingConnections(db) {
  if (antigravityLeaseTableReady(db)) {
    db.run(`DELETE FROM antigravityRefreshLeases WHERE connectionId NOT IN (SELECT id FROM providerConnections)`);
  }
  if (tableColumnNames(db, "antigravityRecoveryCredentials").has("connectionId")) {
    db.run(`DELETE FROM antigravityRecoveryCredentials WHERE connectionId NOT IN (SELECT id FROM providerConnections)`);
  }
}
