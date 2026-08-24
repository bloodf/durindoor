import { createHash, randomUUID } from "node:crypto";
import { QUOTA_WRITE_LOCK_SQL } from "./quotaSql.js";
import {
  canonicalizeQuotaNow,
  normalizeQuotaIdentifier,
  normalizeQuotaIdentity,
  quotaIdentityKey } from
"../../../shared/utils/quotaSnapshot.js";
import { QUOTA_SELECTION_DEFAULTS, resolveQuotaLeaseMs } from "../../../../open-sse/config/quotaSelection.js";
import { isNumber, isObject, isString } from "../../../shared/utils/typeChecks.js";

const TERMINAL_REASONS = new Set([
"success", "capacity_race", "pre_dispatch", "upstream_error",
"transport_error", "abort", "timeout", "stream_error", "stream_cancel",
"malformed_terminal", "fallback", "lease_expired", "snapshot_superseded",
"shutdown"]
);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

async function resolveAdapter(adapter = null) {
  if (adapter) return adapter;
  const { getAdapter } = await import("../driver.js");
  return getAdapter();
}

export class QuotaReservationError extends Error {
  constructor(message, code = "QUOTA_RESERVATION_ERROR") {
    super(message);
    this.name = "QuotaReservationError";
    this.code = code;
  }
}

export class QuotaCapacityUnavailableError extends QuotaReservationError {
  constructor(reason = "capacity_exhausted") {
    super("Fresh provider quota has no reservable capacity", "QUOTA_CAPACITY_UNAVAILABLE");
    this.reason = reason;
    this.status = 503;
  }
}

function iso(value = Date.now()) {
  return canonicalizeQuotaNow(value).value;
}

function validateHash(value, label) {
  if (!isString(value) || !HASH_PATTERN.test(value)) {
    throw new QuotaReservationError(`${label} must be a SHA-256 hex digest`, "INVALID_QUOTA_RESERVATION");
  }
  return value;
}

export function hashQuotaRoute(value) {
  return createHash("sha256").update(String(value || "quota-route")).digest("hex");
}

function normalizeReason(reason, fallback = "pre_dispatch") {
  return TERMINAL_REASONS.has(reason) ? reason : fallback;
}

function normalizeItem(value, connectionId, provider) {
  if (!value || !isObject(value) || Array.isArray(value)) {
    throw new QuotaReservationError("Reservation item must be an object", "INVALID_QUOTA_RESERVATION");
  }
  const identity = normalizeQuotaIdentity({
    connectionId,
    provider,
    accountKey: value.accountKey,
    resourceKey: value.resourceKey,
    dimensionKey: value.dimensionKey
  }, { allowCanonicalSentinels: true });
  const requiredAmount = value.requiredAmount ?? 1;
  if (!isNumber(requiredAmount) || !Number.isFinite(requiredAmount) || requiredAmount <= 0 || requiredAmount > Number.MAX_SAFE_INTEGER) {
    throw new QuotaReservationError("Reservation amount must be a finite positive number", "INVALID_QUOTA_RESERVATION");
  }
  const routingFloorEnabled = value.routingFloorEnabled === true;
  const routingFloorRatio = isNumber(value.routingFloorRatio) &&
  Number.isFinite(value.routingFloorRatio) &&
  value.routingFloorRatio >= 0 &&
  value.routingFloorRatio <= 1 ?
  value.routingFloorRatio :
  QUOTA_SELECTION_DEFAULTS.routingFloorRatio;
  return { ...identity, requiredAmount, routingFloorEnabled, routingFloorRatio };
}

function normalizeAcquire(value, now) {
  if (!value || !isObject(value) || Array.isArray(value)) {
    throw new QuotaReservationError("Reservation request must be an object", "INVALID_QUOTA_RESERVATION");
  }
  const connectionId = normalizeQuotaIdentifier(value.connectionId, "reservation.connectionId");
  const provider = normalizeQuotaIdentifier(value.provider, "reservation.provider");
  const routeKeyHash = validateHash(value.routeKeyHash, "reservation.routeKeyHash");
  const ownerEpoch = validateHash(value.ownerEpoch, "reservation.ownerEpoch");
  if (!Array.isArray(value.alternatives) || value.alternatives.length === 0 || value.alternatives.length > QUOTA_SELECTION_DEFAULTS.maxItems) {
    throw new QuotaReservationError("Reservation alternatives must be a bounded non-empty array", "INVALID_QUOTA_RESERVATION");
  }
  const alternatives = value.alternatives.map((bundle) => {
    if (!Array.isArray(bundle) || bundle.length === 0 || bundle.length > QUOTA_SELECTION_DEFAULTS.maxItems) {
      throw new QuotaReservationError("Each reservation alternative must be a bounded non-empty array", "INVALID_QUOTA_RESERVATION");
    }
    const items = bundle.map((item) => normalizeItem(item, connectionId, provider));
    const keys = new Set(items.map((item) => JSON.stringify([item.accountKey, item.resourceKey, item.dimensionKey])));
    if (keys.size !== items.length) throw new QuotaReservationError("Reservation bundle contains a duplicate identity", "INVALID_QUOTA_RESERVATION");
    return items;
  });
  const leaseMs = resolveQuotaLeaseMs(value.leaseMs);
  const acquiredAt = iso(now);
  return {
    id: randomUUID(),
    connectionId,
    provider,
    routeKeyHash,
    ownerEpoch,
    alternatives,
    leaseMs,
    acquiredAt,
    leaseExpiresAt: iso(Date.parse(acquiredAt) + leaseMs)
  };
}

function acquireWriterLock(db) {
  const lock = db.run(QUOTA_WRITE_LOCK_SQL);
  if ((lock.changes || 0) !== 1) throw new QuotaReservationError("Quota storage is not initialized");
}

function reapExpiredSync(db, nowIso) {
  const undispatched = db.run(
    `UPDATE quotaReservations
     SET state='released', terminalAt=?, terminalReason='lease_expired'
     WHERE state='active' AND dispatchedAt IS NULL AND leaseExpiresAt <= ?`,
    [nowIso, nowIso]
  ).changes || 0;
  const dispatched = db.run(
    `UPDATE quotaReservations
     SET state='abandoned', terminalAt=?, terminalReason='lease_expired'
     WHERE state='active' AND dispatchedAt IS NOT NULL AND leaseExpiresAt <= ?`,
    [nowIso, nowIso]
  ).changes || 0;
  return { released: undispatched, abandoned: dispatched };
}

function pruneTerminalSync(db, nowIso) {
  const retentionCutoff = iso(Date.parse(nowIso) - QUOTA_SELECTION_DEFAULTS.terminalRetentionMs);
  // A committed/abandoned debit is no longer needed once every basis snapshot
  // has been superseded, gone stale, or reset. Released history is retained for
  // a bounded diagnostics/fairness window only.
  return db.run(
    `DELETE FROM quotaReservations
     WHERE state IN ('committed','released','abandoned') AND (
       terminalAt < ? OR (
         state IN ('committed','abandoned') AND NOT EXISTS (
           SELECT 1
           FROM quotaReservationItems i
           JOIN providerQuotaSnapshots s
             ON s.connectionId=quotaReservations.connectionId
            AND s.accountKey=i.accountKey
            AND s.resourceKey=i.resourceKey
            AND s.dimensionKey=i.dimensionKey
           WHERE i.reservationId=quotaReservations.id
             AND s.staleAt > ?
             AND (
               (s.observedAt=i.basisObservedAt AND (i.basisResetAt IS NULL OR i.basisResetAt > ?))
               OR (s.observedAt <= quotaReservations.terminalAt AND (s.resetAt IS NULL OR s.resetAt > ?))
             )
         )
       )
     )`,
    [retentionCutoff, nowIso, nowIso, nowIso]
  ).changes || 0;
}

function currentSnapshot(db, item, nowIso) {
  return db.get(
    `SELECT s.accountKey, s.resourceKey, s.dimensionKey, s.state, s.limitKind,
            s.limitValue, s.remainingValue, s.remainingRatio, s.unit,
            s.resetAt, s.observedAt, s.staleAt
     FROM providerQuotaSnapshots s
     JOIN providerConnections c ON c.id=s.connectionId
     WHERE s.connectionId=? AND c.provider=? AND s.accountKey=?
       AND s.resourceKey=? AND s.dimensionKey=?
       AND s.observedAt <= ? AND s.staleAt > ?`,
    [
    item.connectionId, item.provider, item.accountKey, item.resourceKey,
    item.dimensionKey, nowIso, nowIso]

  ) || null;
}

function requestCapacityState(snapshot) {
  if (!snapshot) return "untracked";
  const namespace = String(snapshot?.dimensionKey || "").split(":", 1)[0];
  if (namespace !== "requests" ||
  snapshot?.unit != null && snapshot.unit !== "requests" ||
  snapshot.limitKind !== "bounded" ||
  !Number.isFinite(snapshot.limitValue) ||
  !Number.isFinite(snapshot.remainingValue)) {
    return "untracked";
  }
  if (["exhausted", "cooldown"].includes(snapshot.state)) return "blocked";
  return ["available", "low"].includes(snapshot.state) ? "trackable" : "untracked";
}

function activeDebit(db, item, snapshot, nowIso) {
  const row = db.get(
    `SELECT COALESCE(SUM(
       CASE
         WHEN r.state='active' AND r.leaseExpiresAt > ? THEN i.reservedAmount
         WHEN r.state IN ('committed','abandoned')
              AND (
                (i.basisObservedAt = ? AND (i.basisResetAt IS NULL OR i.basisResetAt > ?))
                OR (? <= r.terminalAt AND (? IS NULL OR ? > ?))
              )
           THEN COALESCE(i.committedAmount, i.reservedAmount)
         ELSE 0
       END
     ), 0) AS debit,
     COALESCE(SUM(CASE WHEN r.state='active' AND r.leaseExpiresAt > ? THEN 1 ELSE 0 END), 0) AS pressure
     FROM quotaReservationItems i
     JOIN quotaReservations r ON r.id=i.reservationId
     WHERE r.connectionId=? AND i.accountKey=? AND i.resourceKey=?
       AND i.dimensionKey=?`,
    [
    nowIso,
    snapshot.observedAt, nowIso,
    snapshot.observedAt, snapshot.resetAt, snapshot.resetAt, nowIso,
    nowIso, item.connectionId,
    item.accountKey, item.resourceKey, item.dimensionKey]

  );
  return { debit: Number(row?.debit) || 0, pressure: Number(row?.pressure) || 0 };
}

function evaluateBundle(db, items, nowIso) {
  const evaluated = [];
  let untracked = false;
  for (const item of items) {
    const snapshot = currentSnapshot(db, item, nowIso);
    const capacityState = requestCapacityState(snapshot);
    if (capacityState === "untracked") {
      untracked = true;
      continue;
    }
    if (capacityState === "blocked") return { eligible: false, reason: "capacity_exhausted" };
    const { debit, pressure } = activeDebit(db, item, snapshot, nowIso);
    const effectiveRemaining = Math.max(0, snapshot.remainingValue - debit);
    if (effectiveRemaining < item.requiredAmount) return { eligible: false, reason: "capacity_exhausted" };
    const effectiveRatio = snapshot.limitValue > 0 ?
    effectiveRemaining / snapshot.limitValue :
    0;
    if (item.routingFloorEnabled &&
    effectiveRatio <= item.routingFloorRatio + QUOTA_SELECTION_DEFAULTS.routingFloorEpsilon) {
      return { eligible: false, reason: "below_routing_floor" };
    }
    evaluated.push({
      ...item,
      unit: snapshot.unit || "requests",
      basisObservedAt: snapshot.observedAt,
      basisResetAt: snapshot.resetAt || null,
      effectiveRemaining,
      effectiveRatio,
      pressure
    });
  }
  // Preserve every still-fresh bounded member of an all-required bundle. A
  // vanished ratio-only/request constraint fails open, but it must not bypass
  // atomic capacity that can still be proven for sibling windows.
  if (untracked && evaluated.length === 0) return { eligible: false, reason: "untracked" };
  return {
    eligible: true,
    items: evaluated,
    effectiveRatio: Math.min(...evaluated.map((item) => item.effectiveRatio)),
    pressure: evaluated.reduce((sum, item) => sum + item.pressure, 0),
    stableKey: JSON.stringify(evaluated.map((item) => [item.accountKey, item.resourceKey, item.dimensionKey]))
  };
}

function chooseBundle(db, alternatives, nowIso) {
  const evaluated = alternatives.map((items) => evaluateBundle(db, items, nowIso));
  const selected = evaluated.
  filter((candidate) => candidate?.eligible).
  sort((left, right) =>
  right.effectiveRatio - left.effectiveRatio ||
  left.stableKey.localeCompare(right.stableKey)
  )[0] || null;
  if (selected) return { selected, reason: null };
  return {
    selected: null,
    // For alternative pools, one observation disappearing between preflight
    // and acquire means capacity can no longer be proven either way. Preserve
    // the established missing/stale fail-open contract instead of fabricating
    // local exhaustion. Definitive failures remain fail-closed when every
    // alternative is still trackable.
    reason: evaluated.some((candidate) => candidate?.reason === "untracked") ?
    "untracked" :
    evaluated.some((candidate) => candidate?.reason === "below_routing_floor") ?
    "below_routing_floor" :
    "capacity_exhausted"
  };
}

export function acquireQuotaReservationSync(db, value, { now = Date.now() } = {}) {
  const request = normalizeAcquire(value, now);
  if (db.capabilities?.sharedFileTransactions !== true) {
    // A process-local adapter may safely prove that every planned constraint
    // disappeared/became untracked and preserve the fail-open contract. It
    // must still fail closed whenever fresh finite capacity would require
    // coordination across processes.
    const preview = chooseBundle(db, request.alternatives, request.acquiredAt);
    if (!preview.selected && preview.reason === "untracked") {
      return { acquired: false, reason: "untracked" };
    }
    throw new QuotaCapacityUnavailableError("driver_unsupported");
  }
  let result = null;
  db.transaction(() => {
    acquireWriterLock(db);
    const connection = db.get(`SELECT provider FROM providerConnections WHERE id=?`, [request.connectionId]);
    if (!connection || connection.provider !== request.provider) {
      throw new QuotaReservationError("Reservation connection/provider mismatch", "INVALID_QUOTA_RESERVATION");
    }
    reapExpiredSync(db, request.acquiredAt);
    pruneTerminalSync(db, request.acquiredAt);
    const choice = chooseBundle(db, request.alternatives, request.acquiredAt);
    const selected = choice.selected;
    if (!selected) {
      result = { acquired: false, reason: choice.reason };
      return;
    }
    db.run(
      `INSERT INTO quotaReservations(
        id, connectionId, provider, routeKeyHash, state, ownerEpoch,
        acquiredAt, dispatchedAt, terminalAt, leaseExpiresAt,
        lastHeartbeatAt, terminalReason
      ) VALUES(?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?, ?, NULL)`,
      [
      request.id, request.connectionId, request.provider, request.routeKeyHash,
      request.ownerEpoch, request.acquiredAt, request.leaseExpiresAt,
      request.acquiredAt]

    );
    for (const item of selected.items) {
      db.run(
        `INSERT INTO quotaReservationItems(
          reservationId, accountKey, resourceKey, dimensionKey, unit,
          reservedAmount, committedAmount, basisObservedAt, basisResetAt
        ) VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
        request.id, item.accountKey, item.resourceKey, item.dimensionKey,
        item.unit, item.requiredAmount, item.basisObservedAt, item.basisResetAt]

      );
    }
    result = {
      acquired: true,
      reservationId: request.id,
      effectiveRatio: selected.effectiveRatio,
      items: selected.items.map((item) => ({
        accountKey: item.accountKey,
        resourceKey: item.resourceKey,
        dimensionKey: item.dimensionKey,
        reservedAmount: item.requiredAmount,
        basisObservedAt: item.basisObservedAt
      }))
    };
  });
  return result || { acquired: false, reason: "capacity_exhausted" };
}

export async function acquireQuotaReservation(value, options = {}) {
  const db = await resolveAdapter(options.adapter);
  return acquireQuotaReservationSync(db, value, options);
}

function reservationState(db, id) {
  return db.get(`SELECT state, dispatchedAt, terminalAt, terminalReason FROM quotaReservations WHERE id=?`, [id]) || null;
}

function mutateActiveSync(db, id, ownerEpoch, nowIso, update, params, extraWhere = "") {
  validateHash(ownerEpoch, "reservation.ownerEpoch");
  let changes = 0;
  db.transaction(() => {
    acquireWriterLock(db);
    reapExpiredSync(db, nowIso);
    changes = db.run(
      `UPDATE quotaReservations SET ${update}
       WHERE id=? AND ownerEpoch=? AND state='active' AND leaseExpiresAt > ? ${extraWhere}`,
      [...params, id, ownerEpoch, nowIso]
    ).changes || 0;
  });
  return { changed: changes === 1, ...reservationState(db, id) };
}

export async function markQuotaReservationDispatched(id, { ownerEpoch, now = Date.now(), adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  const timestamp = iso(now);
  return mutateActiveSync(db, id, ownerEpoch, timestamp, "dispatchedAt=COALESCE(dispatchedAt, ?), lastHeartbeatAt=?", [timestamp, timestamp]);
}

export async function heartbeatQuotaReservation(id, { ownerEpoch, now = Date.now(), leaseMs, adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  const timestamp = iso(now);
  const expires = iso(Date.parse(timestamp) + resolveQuotaLeaseMs(leaseMs));
  return mutateActiveSync(db, id, ownerEpoch, timestamp, "lastHeartbeatAt=?, leaseExpiresAt=?", [timestamp, expires]);
}

export async function commitQuotaReservation(id, { ownerEpoch, now = Date.now(), adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  const timestamp = iso(now);
  let changes = 0;
  db.transaction(() => {
    acquireWriterLock(db);
    validateHash(ownerEpoch, "reservation.ownerEpoch");
    reapExpiredSync(db, timestamp);
    changes = db.run(
      `UPDATE quotaReservations
       SET state='committed', terminalAt=?, terminalReason='success', lastHeartbeatAt=?
       WHERE id=? AND ownerEpoch=? AND state='active' AND leaseExpiresAt > ?
         AND dispatchedAt IS NOT NULL`,
      [timestamp, timestamp, id, ownerEpoch, timestamp]
    ).changes || 0;
    if (changes === 1) {
      // Batch 4 accounts one physical request dispatch. Token/cost/modal amounts are
      // reconciled by batch 5 and must not be guessed here.
      db.run(
        `UPDATE quotaReservationItems SET committedAmount=reservedAmount
         WHERE reservationId=? AND committedAmount IS NULL`,
        [id]
      );
    }
  });
  return { changed: changes === 1, ...reservationState(db, id) };
}

export async function releaseQuotaReservation(id, reason = "pre_dispatch", { ownerEpoch, now = Date.now(), adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  const timestamp = iso(now);
  return mutateActiveSync(
    db,
    id,
    ownerEpoch,
    timestamp,
    "state='released', terminalAt=?, terminalReason=?, lastHeartbeatAt=?",
    [timestamp, normalizeReason(reason), timestamp]
  );
}

export async function reapExpiredQuotaReservations({ now = Date.now(), adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  const timestamp = iso(now);
  let result;
  db.transaction(() => {
    acquireWriterLock(db);
    result = reapExpiredSync(db, timestamp);
    result.pruned = pruneTerminalSync(db, timestamp);
  });
  return result;
}

export async function getQuotaReservationPressure({ provider, connectionIds = [], now = Date.now(), adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  const normalizedProvider = provider == null ? null : normalizeQuotaIdentifier(provider, "pressure.provider");
  const ids = [...new Set(connectionIds.map((id) => normalizeQuotaIdentifier(id, "pressure.connectionId")))].slice(0, 1024);
  if (!normalizedProvider && ids.length === 0) throw new QuotaReservationError("Pressure query requires provider or connection ids");
  const timestamp = iso(now);
  const where = [];
  const params = [timestamp];
  if (normalizedProvider) {where.push("provider=?");params.push(normalizedProvider);}
  if (ids.length > 0) {
    where.push(`connectionId IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  const rows = db.all(
    `SELECT connectionId,
       SUM(CASE WHEN state='active' AND leaseExpiresAt > ? THEN 1 ELSE 0 END) AS activeCount,
       MAX(acquiredAt) AS lastSelectedAt
     FROM quotaReservations
     WHERE ${where.join(" AND ")}
     GROUP BY connectionId`,
    params
  );
  const result = new Map(rows.map((row) => [row.connectionId, {
    activeCount: Number(row.activeCount) || 0,
    lastSelectedAt: row.lastSelectedAt || null,
    debits: new Map()
  }]));

  const debitWhere = [];
  const debitParams = [timestamp, timestamp, timestamp, timestamp, timestamp];
  if (normalizedProvider) {debitWhere.push("r.provider=?");debitParams.push(normalizedProvider);}
  if (ids.length > 0) {
    debitWhere.push(`r.connectionId IN (${ids.map(() => "?").join(",")})`);
    debitParams.push(...ids);
  }
  const debitRows = db.all(
    `SELECT r.connectionId, r.provider, i.accountKey, i.resourceKey, i.dimensionKey,
       COALESCE(SUM(CASE
         WHEN r.state='active' AND r.leaseExpiresAt > ? THEN i.reservedAmount
         WHEN r.state IN ('committed','abandoned')
              AND (
                (i.basisObservedAt=s.observedAt AND (i.basisResetAt IS NULL OR i.basisResetAt > ?))
                OR (s.observedAt <= r.terminalAt AND (s.resetAt IS NULL OR s.resetAt > ?))
              )
           THEN COALESCE(i.committedAmount, i.reservedAmount)
         ELSE 0
       END), 0) AS debit
     FROM quotaReservationItems i
     JOIN quotaReservations r ON r.id=i.reservationId
     JOIN providerQuotaSnapshots s
       ON s.connectionId=r.connectionId
      AND s.accountKey=i.accountKey
      AND s.resourceKey=i.resourceKey
      AND s.dimensionKey=i.dimensionKey
     WHERE s.observedAt <= ? AND s.staleAt > ?
       AND ${debitWhere.join(" AND ")}
     GROUP BY r.connectionId, r.provider, i.accountKey, i.resourceKey, i.dimensionKey`,
    debitParams
  );
  for (const row of debitRows) {
    const debit = Number(row.debit) || 0;
    if (debit <= 0) continue;
    const state = result.get(row.connectionId) || {
      activeCount: 0,
      lastSelectedAt: null,
      debits: new Map()
    };
    state.debits.set(quotaIdentityKey({
      connectionId: row.connectionId,
      provider: row.provider,
      accountKey: row.accountKey,
      resourceKey: row.resourceKey,
      dimensionKey: row.dimensionKey
    }), debit);
    result.set(row.connectionId, state);
  }
  return result;
}

export async function hasActiveDispatchedQuotaReservations({ adapter = null } = {}) {
  const db = await resolveAdapter(adapter);
  return Boolean(db.get(
    `SELECT 1 AS present FROM quotaReservations
     WHERE state='active' AND dispatchedAt IS NOT NULL LIMIT 1`
  ));
}

/** Synchronous import/shutdown guard. Caller must invoke inside a transaction. */
export function assertNoActiveQuotaReservationsSync(db, { now = Date.now() } = {}) {
  const timestamp = iso(now);
  acquireWriterLock(db);
  reapExpiredSync(db, timestamp);
  const active = db.get(
    `SELECT 1 AS present FROM quotaReservations
     WHERE state='active' AND leaseExpiresAt > ? LIMIT 1`,
    [timestamp]
  );
  if (active) throw new QuotaReservationError("Database operation is unavailable while provider requests are active", "ACTIVE_QUOTA_RESERVATIONS");
}

/** Guard targeted connection deletion under the same quota writer lock. */
export function assertNoActiveQuotaReservationsForTargetSync(db, {
  connectionIds = [],
  provider = null,
  now = Date.now()
} = {}) {
  const timestamp = iso(now);
  const ids = [...new Set(connectionIds.map((id) => normalizeQuotaIdentifier(id, "deletion.connectionId")))].slice(0, 1024);
  const normalizedProvider = provider == null ?
  null :
  normalizeQuotaIdentifier(provider, "deletion.provider");
  if (ids.length === 0 && !normalizedProvider) {
    throw new QuotaReservationError("Connection deletion guard requires a target", "INVALID_QUOTA_RESERVATION");
  }
  acquireWriterLock(db);
  reapExpiredSync(db, timestamp);
  const where = ["state='active'", "leaseExpiresAt > ?"];
  const params = [timestamp];
  if (normalizedProvider) {where.push("provider=?");params.push(normalizedProvider);}
  if (ids.length > 0) {
    where.push(`connectionId IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (db.get(`SELECT 1 AS present FROM quotaReservations WHERE ${where.join(" AND ")} LIMIT 1`, params)) {
    throw new QuotaReservationError(
      "Provider connection cannot be deleted while a request is active",
      "ACTIVE_QUOTA_RESERVATIONS"
    );
  }
}