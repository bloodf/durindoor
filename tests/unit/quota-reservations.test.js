import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import m007 from "../../src/lib/db/migrations/007-provider-quota-snapshots.js";
import m008 from "../../src/lib/db/migrations/008-quota-reservations.js";
import {
  acquireQuotaReservationSync,
  commitQuotaReservation,
  getQuotaReservationPressure,
  hashQuotaRoute,
  heartbeatQuotaReservation,
  markQuotaReservationDispatched,
  reapExpiredQuotaReservations,
  releaseQuotaReservation,
} from "../../src/lib/db/repos/quotaReservationsRepo.js";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const OWNER = "a".repeat(64);
const OTHER_OWNER = "b".repeat(64);
let db;

function adapter(raw, { shared = true } = {}) {
  return {
    driver: shared ? "test-shared-sqlite" : "test-process-local",
    capabilities: { sharedFileTransactions: shared },
    exec: (sql) => raw.exec(sql),
    run: (sql, params = []) => raw.prepare(sql).run(params),
    get: (sql, params = []) => raw.prepare(sql).get(params),
    all: (sql, params = []) => raw.prepare(sql).all(params),
    transaction: (fn) => raw.transaction(fn)(),
  };
}

function setup() {
  db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta(key, value) VALUES('schemaVersion', '8');
    CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
    INSERT INTO providerConnections(id, provider) VALUES('conn-1', 'kiro'), ('conn-2', 'kiro');
  `);
  m007.up(adapter(db));
  m008.up(adapter(db));
  return adapter(db);
}

function putSnapshot({
  connectionId = "conn-1",
  dimensionKey = "requests:session",
  remaining = 1,
  limit = 100,
  observedAt = NOW,
  staleAt = NOW + 60_000,
  resetAt = NOW + 60_000,
} = {}) {
  db.prepare(`
    INSERT INTO providerQuotaSnapshots(
      connectionId, accountKey, resourceKey, dimensionKey, state, limitKind,
      limitValue, usedValue, remainingValue, remainingRatio, unit, resetAt,
      cooldownUntil, observedAt, staleAt, sourceType, sourceId, reasonCode, metadataJson
    ) VALUES(?, 'scope:connection', 'resource:agentic_request', ?, ?, 'bounded',
      ?, ?, ?, ?, 'requests', ?, NULL, ?, ?, 'provider_api', 'kiro:test:v1', NULL, '{}')
    ON CONFLICT(connectionId, accountKey, resourceKey, dimensionKey) DO UPDATE SET
      state=excluded.state, limitValue=excluded.limitValue, usedValue=excluded.usedValue,
      remainingValue=excluded.remainingValue, remainingRatio=excluded.remainingRatio,
      resetAt=excluded.resetAt, observedAt=excluded.observedAt, staleAt=excluded.staleAt
  `).run(
    connectionId,
    dimensionKey,
    remaining === 0 ? "exhausted" : remaining / limit <= 0.2 ? "low" : "available",
    limit,
    limit - remaining,
    remaining,
    remaining / limit,
    new Date(resetAt).toISOString(),
    new Date(observedAt).toISOString(),
    new Date(staleAt).toISOString(),
  );
}

function request({
  connectionId = "conn-1",
  dimensions = ["requests:session"],
  alternatives = null,
  floorEnabled = false,
  floorRatio = 0.02,
  leaseMs = 420_000,
} = {}) {
  const bundle = dimensions.map((dimensionKey) => ({
    accountKey: "scope:connection",
    resourceKey: "resource:agentic_request",
    dimensionKey,
    requiredAmount: 1,
    routingFloorEnabled: floorEnabled,
    routingFloorRatio: floorRatio,
  }));
  return {
    connectionId,
    provider: "kiro",
    routeKeyHash: hashQuotaRoute("kiro/claude-sonnet"),
    ownerEpoch: OWNER,
    alternatives: alternatives || [bundle],
    leaseMs,
  };
}

afterEach(() => db?.close());

describe("persistent quota reservations", () => {
  it("admits exactly one acquire at the final request slot and keeps committed demand until refresh", async () => {
    const store = setup();
    putSnapshot({ remaining: 1 });

    const first = acquireQuotaReservationSync(store, request(), { now: NOW + 1 });
    expect(first.acquired).toBe(true);
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 2 })).toMatchObject({ acquired: false, reason: "capacity_exhausted" });

    expect((await markQuotaReservationDispatched(first.reservationId, { ownerEpoch: OWNER, now: NOW + 3, adapter: store })).changed).toBe(true);
    expect((await commitQuotaReservation(first.reservationId, { ownerEpoch: OWNER, now: NOW + 4, adapter: store })).changed).toBe(true);
    expect((await commitQuotaReservation(first.reservationId, { ownerEpoch: OWNER, now: NOW + 5, adapter: store })).changed).toBe(false);
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 6 }).acquired).toBe(false);
    const pressure = await getQuotaReservationPressure({
      provider: "kiro",
      connectionIds: ["conn-1"],
      now: NOW + 6,
      adapter: store,
    });
    expect([...pressure.get("conn-1").debits.values()]).toEqual([1]);

    putSnapshot({ remaining: 1, observedAt: NOW + 10, staleAt: NOW + 70_000, resetAt: NOW + 70_000 });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 11 }).acquired).toBe(true);
  });

  it("keeps a same-millisecond committed debit on its exact observation basis", async () => {
    const store = setup();
    putSnapshot({ remaining: 1, observedAt: NOW });

    const held = acquireQuotaReservationSync(store, request(), { now: NOW });
    expect(held.acquired).toBe(true);
    expect((await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OWNER, now: NOW, adapter: store })).changed).toBe(true);
    expect((await commitQuotaReservation(held.reservationId, { ownerEpoch: OWNER, now: NOW, adapter: store })).changed).toBe(true);

    expect(acquireQuotaReservationSync(store, request(), { now: NOW }))
      .toMatchObject({ acquired: false, reason: "capacity_exhausted" });
  });

  it("keeps a live hold across a newer snapshot of the same stable identity", async () => {
    const store = setup();
    putSnapshot({ remaining: 1, observedAt: NOW });
    const held = acquireQuotaReservationSync(store, request(), { now: NOW + 1 });
    expect(held.acquired).toBe(true);
    expect((await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OWNER, now: NOW + 2, adapter: store })).changed).toBe(true);

    putSnapshot({ remaining: 1, observedAt: NOW + 3, staleAt: NOW + 60_003, resetAt: NOW + 60_003 });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 4 }))
      .toMatchObject({ acquired: false, reason: "capacity_exhausted" });

    expect((await releaseQuotaReservation(held.reservationId, "upstream_error", { ownerEpoch: OWNER, now: NOW + 5, adapter: store })).changed).toBe(true);
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 6 }).acquired).toBe(true);
  });

  it("keeps a committed debit when a newer snapshot was observed before terminal", async () => {
    const store = setup();
    putSnapshot({ remaining: 1, observedAt: NOW });
    const held = acquireQuotaReservationSync(store, request(), { now: NOW + 1 });
    await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OWNER, now: NOW + 2, adapter: store });

    putSnapshot({ remaining: 1, observedAt: NOW + 3, staleAt: NOW + 60_003, resetAt: NOW + 60_003 });
    await commitQuotaReservation(held.reservationId, { ownerEpoch: OWNER, now: NOW + 4, adapter: store });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 5 }))
      .toMatchObject({ acquired: false, reason: "capacity_exhausted" });

    putSnapshot({ remaining: 1, observedAt: NOW + 6, staleAt: NOW + 60_006, resetAt: NOW + 60_006 });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 7 }).acquired).toBe(true);
  });

  it("keeps a committed debit when a pre-terminal observation is persisted late", async () => {
    const store = setup();
    putSnapshot({ remaining: 1, observedAt: NOW });
    const held = acquireQuotaReservationSync(store, request(), { now: NOW + 1 });
    await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OWNER, now: NOW + 2, adapter: store });
    await commitQuotaReservation(held.reservationId, { ownerEpoch: OWNER, now: NOW + 5, adapter: store });

    putSnapshot({ remaining: 1, observedAt: NOW + 4, staleAt: NOW + 60_004, resetAt: NOW + 60_004 });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 6 }))
      .toMatchObject({ acquired: false, reason: "capacity_exhausted" });
  });

  it("uses the carried snapshot reset instead of expiring on the old basis reset", async () => {
    const store = setup();
    putSnapshot({ remaining: 1, observedAt: NOW, resetAt: NOW + 10, staleAt: NOW + 2_000 });
    const held = acquireQuotaReservationSync(store, request(), { now: NOW + 1 });
    await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OWNER, now: NOW + 2, adapter: store });
    putSnapshot({ remaining: 1, observedAt: NOW + 3, resetAt: NOW + 1_000, staleAt: NOW + 2_000 });
    await commitQuotaReservation(held.reservationId, { ownerEpoch: OWNER, now: NOW + 5, adapter: store });

    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 11 }))
      .toMatchObject({ acquired: false, reason: "capacity_exhausted" });
  });

  it("fails open when the preflight observation is stale at atomic acquire", () => {
    const store = setup();
    putSnapshot({ remaining: 1, observedAt: NOW, staleAt: NOW + 10 });

    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 10 }))
      .toMatchObject({ acquired: false, reason: "untracked" });
  });

  it("retains atomic capacity for the fresh subset of an all-required bundle", () => {
    const store = setup();
    putSnapshot({ dimensionKey: "requests:session", remaining: 1, staleAt: NOW + 10 });
    putSnapshot({ dimensionKey: "requests:weekly", remaining: 1, staleAt: NOW + 60_000 });

    const first = acquireQuotaReservationSync(store, request({
      dimensions: ["requests:session", "requests:weekly"],
    }), { now: NOW + 10 });
    expect(first.acquired).toBe(true);
    expect(store.all(`SELECT dimensionKey FROM quotaReservationItems WHERE reservationId=?`, [first.reservationId]))
      .toEqual([{ dimensionKey: "requests:weekly" }]);

    expect(acquireQuotaReservationSync(store, request({
      dimensions: ["requests:session", "requests:weekly"],
    }), { now: NOW + 11 })).toMatchObject({ acquired: false, reason: "capacity_exhausted" });
  });

  it("releases a proven pre-dispatch hold exactly once", async () => {
    const store = setup();
    putSnapshot({ remaining: 1 });
    const first = acquireQuotaReservationSync(store, request(), { now: NOW + 1 });
    expect((await releaseQuotaReservation(first.reservationId, "pre_dispatch", { ownerEpoch: OWNER, now: NOW + 2, adapter: store })).changed).toBe(true);
    expect((await releaseQuotaReservation(first.reservationId, "pre_dispatch", { ownerEpoch: OWNER, now: NOW + 3, adapter: store })).changed).toBe(false);
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 4 }).acquired).toBe(true);
  });

  it("acquires all-required bundles atomically", () => {
    const store = setup();
    putSnapshot({ dimensionKey: "requests:session", remaining: 3 });
    putSnapshot({ dimensionKey: "requests:weekly", remaining: 0 });
    const result = acquireQuotaReservationSync(store, request({ dimensions: ["requests:session", "requests:weekly"] }), { now: NOW + 1 });
    expect(result.acquired).toBe(false);
    expect(store.get(`SELECT COUNT(*) AS count FROM quotaReservations`).count).toBe(0);
    expect(store.get(`SELECT COUNT(*) AS count FROM quotaReservationItems`).count).toBe(0);
  });

  it("chooses exactly one highest-headroom any-sufficient alternative", () => {
    const store = setup();
    putSnapshot({ dimensionKey: "requests:trial", remaining: 2 });
    putSnapshot({ dimensionKey: "requests:subscription", remaining: 8 });
    const item = (dimensionKey) => [{
      accountKey: "scope:connection",
      resourceKey: "resource:agentic_request",
      dimensionKey,
      requiredAmount: 1,
    }];
    const result = acquireQuotaReservationSync(store, request({ alternatives: [item("requests:trial"), item("requests:subscription")] }), { now: NOW + 1 });
    expect(result.acquired).toBe(true);
    expect(store.all(`SELECT dimensionKey FROM quotaReservationItems`)).toEqual([{ dimensionKey: "requests:subscription" }]);
  });

  it("keeps the optional two-percent routing floor distinct from absolute capacity", async () => {
    const cases = [
      { remaining: 19.999, enabled: true, acquired: false, reason: "below_routing_floor" },
      { remaining: 20, enabled: true, acquired: false, reason: "below_routing_floor" },
      { remaining: 20.001, enabled: true, acquired: true },
      { remaining: 20, enabled: false, acquired: true },
    ];
    for (const [index, item] of cases.entries()) {
      const store = index === 0 ? setup() : adapter(db);
      db.exec(`DELETE FROM quotaReservationItems; DELETE FROM quotaReservations; DELETE FROM providerQuotaSnapshots;`);
      putSnapshot({ remaining: item.remaining, limit: 1000 });
      const result = acquireQuotaReservationSync(store, request({ floorEnabled: item.enabled }), { now: NOW + 1 });
      expect(result.acquired).toBe(item.acquired);
      if (item.reason) expect(result.reason).toBe(item.reason);
      if (result.acquired) await releaseQuotaReservation(result.reservationId, "pre_dispatch", { ownerEpoch: OWNER, now: NOW + 2, adapter: store });
    }
  });

  it("fences wrong owners and never resurrects an expired lease", async () => {
    const store = setup();
    putSnapshot({ remaining: 1 });
    const held = acquireQuotaReservationSync(store, request({ leaseMs: 60_000 }), { now: NOW + 1 });
    expect((await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OTHER_OWNER, now: NOW + 2, adapter: store })).changed).toBe(false);
    expect((await heartbeatQuotaReservation(held.reservationId, { ownerEpoch: OWNER, now: NOW + 60_002, leaseMs: 60_000, adapter: store })).changed).toBe(false);
    expect(store.get(`SELECT state FROM quotaReservations WHERE id=?`, [held.reservationId]).state).toBe("released");
  });

  it("marks a crashed dispatched lease abandoned and debits it until a post-terminal snapshot", async () => {
    const store = setup();
    putSnapshot({ remaining: 1, staleAt: NOW + 120_000, resetAt: NOW + 120_000 });
    const held = acquireQuotaReservationSync(store, request({ leaseMs: 60_000 }), { now: NOW + 1 });
    await markQuotaReservationDispatched(held.reservationId, { ownerEpoch: OWNER, now: NOW + 2, adapter: store });

    expect(await reapExpiredQuotaReservations({ now: NOW + 60_002, adapter: store }))
      .toMatchObject({ abandoned: 1 });
    expect(store.get(`SELECT state, terminalReason FROM quotaReservations WHERE id=?`, [held.reservationId]))
      .toEqual({ state: "abandoned", terminalReason: "lease_expired" });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 60_003 }))
      .toMatchObject({ acquired: false, reason: "capacity_exhausted" });

    putSnapshot({
      remaining: 1,
      observedAt: NOW + 60_003,
      staleAt: NOW + 180_000,
      resetAt: NOW + 180_000,
    });
    expect(acquireQuotaReservationSync(store, request(), { now: NOW + 60_004 }).acquired).toBe(true);
  });

  it("fails closed for finite capacity on a process-local sql.js-style adapter", () => {
    const store = setup();
    putSnapshot({ remaining: 1 });
    const localOnly = { ...store, capabilities: { sharedFileTransactions: false } };
    expect(() => acquireQuotaReservationSync(localOnly, request(), { now: NOW + 1 }))
      .toThrow(expect.objectContaining({ code: "QUOTA_CAPACITY_UNAVAILABLE", reason: "driver_unsupported" }));
  });

  it("lets a process-local adapter fail open after the planned observation becomes stale", () => {
    const store = setup();
    putSnapshot({ remaining: 1, staleAt: NOW + 10 });
    const localOnly = { ...store, capabilities: { sharedFileTransactions: false } };

    expect(acquireQuotaReservationSync(localOnly, request(), { now: NOW + 10 }))
      .toMatchObject({ acquired: false, reason: "untracked" });
  });
});
