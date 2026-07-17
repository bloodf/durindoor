import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTA_MAX_SOURCE_SNAPSHOTS } from "../../src/shared/constants/quota.js";

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-repo-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedConnection(db, id, provider) {
  const timestamp = "2026-01-01T00:00:00.000Z";
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, 'oauth', ?, 1, '{}', ?, ?)`,
    [id, provider, `${provider} account`, timestamp, timestamp],
  );
}

function makeSnapshot({
  connectionId = "conn-1",
  provider = "gemini",
  accountKey,
  resourceKey,
  dimensionKey = "requests:session",
  observedAt = "2026-01-01T00:00:00.000Z",
  staleAt = "2026-01-01T01:00:00.000Z",
  remaining = 50,
  sourceId = "gemini:quota:v1",
} = {}) {
  return {
    identity: { connectionId, provider, accountKey, resourceKey, dimensionKey },
    state: remaining === 0 ? "exhausted" : "available",
    amounts: {
      limitKind: "bounded",
      limit: 100,
      used: 100 - remaining,
      remaining,
      remainingRatio: remaining / 100,
      unit: "requests",
    },
    timing: { observedAt, staleAt, resetAt: null, cooldownUntil: null },
    provenance: { sourceType: "provider_api", sourceId, reasonCode: null, metadata: { plan: "free" } },
  };
}

function successFetch({ attemptedAt, connectionId = "conn-1", provider = "gemini", sourceId = "gemini:quota:v1" }) {
  return { connectionId, provider, sourceId, outcome: "success", attemptedAt };
}

describe("provider quota snapshot repository", () => {
  it("atomically keeps one identity and allows only strictly newer observations", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");

    const newer = makeSnapshot({
      observedAt: "2026-01-01T00:20:00.000Z",
      staleAt: "2026-01-01T01:20:00.000Z",
      remaining: 40,
    });
    await database.upsertProviderQuotaSnapshot(newer);
    await expect(database.upsertProviderQuotaSnapshot(makeSnapshot({
      dimensionKey: "requests:older-new-identity",
      remaining: 75,
    }))).resolves.toBeNull();
    await database.upsertProviderQuotaSnapshot(makeSnapshot({
      observedAt: newer.timing.observedAt,
      staleAt: newer.timing.staleAt,
      remaining: 10,
    }));

    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
    expect(await database.getProviderQuotaSnapshot({
      connectionId: "conn-1",
      provider: "gemini",
      dimensionKey: "requests:session",
    }, { includeStale: true })).toMatchObject({
      identity: { accountKey: "scope:connection", resourceKey: "scope:account" },
      amounts: { remaining: 40 },
      timing: { observedAt: "2026-01-01T00:20:00.000Z" },
    });

    await database.upsertProviderQuotaSnapshot(makeSnapshot({
      observedAt: "2026-01-01T00:30:00.000Z",
      staleAt: "2026-01-01T01:30:00.000Z",
      remaining: 0,
    }));
    expect((await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true }))[0]).toMatchObject({
      state: "exhausted",
      amounts: { remaining: 0, remainingRatio: 0 },
    });
  });

  it("keeps accounts, resources, and dimensions isolated with deterministic ordering", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");

    const observedAt = "2026-01-01T00:00:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      observedAt,
      snapshots: [
        makeSnapshot({ accountKey: "account:a", resourceKey: "model:a", dimensionKey: "requests:day" }),
        makeSnapshot({ accountKey: "account:b", resourceKey: "model:a", dimensionKey: "requests:day" }),
        makeSnapshot({ accountKey: "account:a", resourceKey: "model:b", dimensionKey: "requests:day" }),
        makeSnapshot({ accountKey: "account:a", resourceKey: "model:a", dimensionKey: "tokens:day" }),
      ],
      fetchState: successFetch({ attemptedAt: observedAt }),
    });

    const rows = await database.listProviderQuotaSnapshots({ provider: "gemini", includeStale: true });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => JSON.stringify(row.identity))).size).toBe(4);
    expect(db.all(`PRAGMA table_info(providerQuotaSnapshots)`).filter((column) => column.pk > 0).every((column) => column.notnull === 1)).toBe(true);
  });

  it("takes the SQLite writer lock before reading a source watermark", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    const operations = [];
    const originalRun = db.run;
    const originalGet = db.get;
    db.run = (sql, params = []) => {
      operations.push(["run", String(sql).trim()]);
      return originalRun(sql, params);
    };
    db.get = (sql, params = []) => {
      operations.push(["get", String(sql).trim()]);
      return originalGet(sql, params);
    };
    try {
      const observedAt = "2026-01-01T00:00:00.000Z";
      await database.replaceProviderQuotaSnapshotsForSource({
        connectionId: "conn-1",
        provider: "gemini",
        sourceId: "gemini:quota:v1",
        observedAt,
        snapshots: [makeSnapshot()],
        fetchState: successFetch({ attemptedAt: observedAt }),
      });
    } finally {
      db.run = originalRun;
      db.get = originalGet;
    }
    expect(operations[0]).toEqual(["run", "UPDATE _meta SET value = value WHERE key = 'schemaVersion'"]);
  });

  it("replaces one source atomically and records failures without erasing its last valid snapshots", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    const firstObservedAt = "2026-01-01T00:00:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      observedAt: firstObservedAt,
      snapshots: [
        makeSnapshot({ accountKey: "account:a", dimensionKey: "requests:day" }),
        makeSnapshot({ accountKey: "account:b", dimensionKey: "requests:day" }),
      ],
      fetchState: successFetch({ attemptedAt: firstObservedAt }),
    });

    const secondObservedAt = "2026-01-01T00:30:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      observedAt: secondObservedAt,
      snapshots: [makeSnapshot({
        accountKey: "account:a",
        dimensionKey: "requests:day",
        observedAt: secondObservedAt,
        staleAt: "2026-01-01T01:30:00.000Z",
        remaining: 20,
      })],
      fetchState: successFetch({ attemptedAt: secondObservedAt }),
    });

    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true })).toHaveLength(1);
    await database.recordQuotaFetchFailure({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      fetchState: {
        outcome: "timeout",
        attemptedAt: "2026-01-01T00:40:00.000Z",
        retryAt: "2026-01-01T00:45:00.000Z",
      },
    });

    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true })).toHaveLength(1);
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1" })).toMatchObject({
      outcome: "timeout",
      reasonCode: "timeout",
      lastObservedAt: secondObservedAt,
      lastSuccessAt: secondObservedAt,
    });
    await expect(database.recordQuotaFetchFailure({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      rawResponse: { authorization: "secret" },
      fetchState: { outcome: "timeout", attemptedAt: "2026-01-01T00:50:00.000Z" },
    })).rejects.toThrow("contains an unsupported field");
    const canary = "sk-secretkeycanary123456";
    const error = await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      observedAt: secondObservedAt,
      snapshots: [],
      fetchState: successFetch({ attemptedAt: secondObservedAt }),
      [canary]: true,
    }).catch((caught) => caught);
    expect(error.message).toBe("quota source replacement contains an unsupported field");
    expect(error.message).not.toContain(canary);
  });

  it("gates equal and older source sets before mutation and preserves empty-set watermarks", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    const sourceId = "gemini:quota:v1";
    const t20 = "2026-01-01T00:20:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId,
      observedAt: t20,
      snapshots: [
        makeSnapshot({ accountKey: "account:a", dimensionKey: "requests:day", observedAt: t20, staleAt: "2026-01-01T01:20:00.000Z", remaining: 20 }),
        makeSnapshot({ accountKey: "account:b", dimensionKey: "requests:day", observedAt: t20, staleAt: "2026-01-01T01:20:00.000Z", remaining: 30 }),
      ],
      fetchState: successFetch({ attemptedAt: t20 }),
    });
    const before = await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId });

    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId,
      observedAt: t20,
      snapshots: [
        makeSnapshot({ accountKey: "account:a", dimensionKey: "requests:day", observedAt: t20, staleAt: "2026-01-01T01:20:00.000Z", remaining: 1 }),
        makeSnapshot({ accountKey: "account:c", dimensionKey: "requests:day", observedAt: t20, staleAt: "2026-01-01T01:20:00.000Z", remaining: 1 }),
      ],
      fetchState: successFetch({ attemptedAt: "2026-01-01T00:25:00.000Z" }),
    });
    let rows = await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true });
    expect(rows.map((row) => [row.identity.accountKey, row.amounts.remaining]).sort()).toEqual([
      ["account:a", 20],
      ["account:b", 30],
    ]);
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId })).toMatchObject({
      ...before,
      attemptedAt: "2026-01-01T00:25:00.000Z",
      lastSuccessAt: "2026-01-01T00:25:00.000Z",
      lastObservedAt: t20,
      outcome: "success",
    });

    const t40 = "2026-01-01T00:40:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1", provider: "gemini", sourceId, observedAt: t40, snapshots: [],
      fetchState: successFetch({ attemptedAt: t40 }),
    });
    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true })).toEqual([]);

    expect(await database.upsertProviderQuotaSnapshot(makeSnapshot({
      accountKey: "account:single-writer",
      observedAt: "2026-01-01T00:35:00.000Z",
      staleAt: "2026-01-01T01:35:00.000Z",
    }))).toBeNull();
    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true })).toEqual([]);

    const t30 = "2026-01-01T00:30:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId,
      observedAt: t30,
      snapshots: [makeSnapshot({ accountKey: "account:resurrected", observedAt: t30, staleAt: "2026-01-01T01:30:00.000Z" })],
      fetchState: successFetch({ attemptedAt: "2026-01-01T00:50:00.000Z" }),
    });
    rows = await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true });
    expect(rows).toEqual([]);
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId })).toMatchObject({
      lastObservedAt: t40,
      lastSuccessAt: "2026-01-01T00:50:00.000Z",
      attemptedAt: "2026-01-01T00:50:00.000Z",
      outcome: "success",
    });
  });

  it("keeps success history monotonic and rejects caller-forged history on failures", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    const t10 = "2026-01-01T00:10:00.000Z";
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1", observedAt: t10,
      snapshots: [makeSnapshot({ observedAt: t10, staleAt: "2026-01-01T01:10:00.000Z" })],
      fetchState: successFetch({ attemptedAt: t10 }),
    });
    await database.recordQuotaFetchFailure({
      connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1",
      fetchState: { outcome: "timeout", attemptedAt: "2026-01-01T00:30:00.000Z" },
    });
    await database.recordQuotaFetchFailure({
      connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1",
      fetchState: { outcome: "network_error", attemptedAt: "2026-01-01T00:20:00.000Z" },
    });
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1" })).toMatchObject({
      outcome: "timeout",
      attemptedAt: "2026-01-01T00:30:00.000Z",
      lastObservedAt: t10,
      lastSuccessAt: t10,
    });
    await expect(database.recordQuotaFetchFailure({
      connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1",
      fetchState: { outcome: "timeout", attemptedAt: "2026-01-01T00:40:00.000Z", lastSuccessAt: "2026-01-01T00:35:00.000Z" },
    })).rejects.toThrow("must not supply trusted success history");

    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      observedAt: t10,
      snapshots: [makeSnapshot({ observedAt: t10, staleAt: "2026-01-01T01:10:00.000Z", remaining: 1 })],
      fetchState: successFetch({ attemptedAt: "2026-01-01T00:40:00.000Z" }),
    });
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1" })).toMatchObject({
      outcome: "success",
      attemptedAt: "2026-01-01T00:40:00.000Z",
      lastObservedAt: t10,
      lastSuccessAt: "2026-01-01T00:40:00.000Z",
    });
    expect(await database.getProviderQuotaSnapshot(makeSnapshot().identity, { includeStale: true })).toMatchObject({
      amounts: { remaining: 50 },
    });
  });

  it("bounds source batches and future observations before database mutation", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    const now = "2026-01-01T00:00:00.000Z";
    const future = makeSnapshot({
      observedAt: "2026-01-01T00:05:00.000Z",
      staleAt: "2026-01-01T01:05:00.000Z",
    });
    await database.upsertProviderQuotaSnapshot(future, { now });
    expect(await database.getProviderQuotaSnapshot(future.identity, { includeStale: true, now })).toBeNull();
    expect(await database.getProviderQuotaSnapshot(future.identity, { includeStale: true, now: future.timing.observedAt })).not.toBeNull();

    await expect(database.upsertProviderQuotaSnapshot(makeSnapshot({
      dimensionKey: "requests:poison",
      observedAt: "2026-01-01T00:05:00.001Z",
      staleAt: "2026-01-01T01:05:00.001Z",
    }), { now })).rejects.toThrow("too far in the future");
    await expect(database.recordQuotaFetchFailure({
      connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1",
      fetchState: { outcome: "timeout", attemptedAt: "2026-01-01T00:05:00.001Z" },
    }, { now })).rejects.toThrow("too far in the future");
    const poisonSource = "gemini:empty-poison:v1";
    await expect(database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: poisonSource,
      observedAt: "2026-01-01T00:05:00.001Z",
      snapshots: [],
      fetchState: successFetch({ sourceId: poisonSource, attemptedAt: "2026-01-01T00:05:00.001Z" }),
    }, { now })).rejects.toThrow("too far in the future");
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: poisonSource,
      observedAt: now,
      snapshots: [makeSnapshot({ sourceId: poisonSource, dimensionKey: "requests:recovered" })],
      fetchState: successFetch({ sourceId: poisonSource, attemptedAt: now }),
    }, { now });
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId: poisonSource }, { now })).toMatchObject({
      lastObservedAt: now,
    });
    await expect(database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1",
      observedAt: now, snapshots: new Array(QUOTA_MAX_SOURCE_SNAPSHOTS + 1),
      fetchState: successFetch({ attemptedAt: now }),
    }, { now })).rejects.toThrow("source limit");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(2);
  });

  it("accepts exactly the per-source snapshot boundary", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    const observedAt = "2026-01-01T00:00:00.000Z";
    const snapshots = Array.from({ length: QUOTA_MAX_SOURCE_SNAPSHOTS }, (_, index) => makeSnapshot({
      dimensionKey: `requests:item-${index}`,
    }));
    await database.replaceProviderQuotaSnapshotsForSource({
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      observedAt,
      snapshots,
      fetchState: successFetch({ attemptedAt: observedAt }),
    });
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(QUOTA_MAX_SOURCE_SNAPSHOTS);
  }, 15_000);

  it("excludes stale rows by default and prunes only rows strictly before the retention boundary", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    await database.upsertProviderQuotaSnapshot(makeSnapshot({
      dimensionKey: "requests:old",
      sourceId: "gemini:old:v1",
      observedAt: "2026-01-01T00:00:00.000Z",
      staleAt: "2026-01-01T01:00:00.000Z",
    }));
    await database.upsertProviderQuotaSnapshot(makeSnapshot({
      dimensionKey: "requests:boundary",
      sourceId: "gemini:boundary:v1",
      observedAt: "2026-01-02T00:00:00.000Z",
      staleAt: "2026-01-02T00:00:00.000Z",
    }));

    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-1", now: "2026-01-01T01:00:00.000Z" })).toHaveLength(0);
    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true })).toHaveLength(2);
    await expect(database.pruneProviderQuotaSnapshots({ now: "2026-01-05T00:00:00.000Z", retentionMs: 3 * 24 * 60 * 60 * 1000 })).resolves.toBe(1);
    expect((await database.listProviderQuotaSnapshots({ connectionId: "conn-1", includeStale: true }))[0].identity.dimensionKey).toBe("requests:boundary");
  });

  it("rejects dangling or wrong-provider writes and immutable provider changes", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");

    await expect(database.upsertProviderQuotaSnapshot(makeSnapshot({ connectionId: "missing" }))).rejects.toThrow("missing provider connection");
    await expect(database.upsertProviderQuotaSnapshot(makeSnapshot({ provider: "codex", sourceId: "codex:quota:v1" }))).rejects.toThrow("does not match");
    await expect(database.updateProviderConnection("conn-1", { provider: "codex" })).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_IMMUTABLE" });
    expect(db.get(`SELECT provider FROM providerConnections WHERE id = 'conn-1'`).provider).toBe("gemini");
  });

  it("cascades quota snapshots and fetch states for single and provider-wide connection deletion", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    seedConnection(db, "conn-2", "gemini");

    for (const connectionId of ["conn-1", "conn-2"]) {
      const observedAt = "2026-01-01T00:00:00.000Z";
      await database.replaceProviderQuotaSnapshotsForSource({
        connectionId,
        provider: "gemini",
        sourceId: "gemini:quota:v1",
        observedAt,
        snapshots: [makeSnapshot({ connectionId })],
        fetchState: successFetch({ connectionId, attemptedAt: observedAt }),
      });
    }

    await database.deleteProviderConnection("conn-1");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
    expect(db.get(`SELECT COUNT(*) AS count FROM quotaFetchStates`).count).toBe(1);
    await database.deleteProviderConnectionsByProvider("gemini");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(0);
    expect(db.get(`SELECT COUNT(*) AS count FROM quotaFetchStates`).count).toBe(0);
    expect(db.all(`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it("rejects single and provider-wide deletion while targeted reservations are active", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    seedConnection(db, "conn-1", "gemini");
    seedConnection(db, "conn-2", "gemini");
    const now = Date.now();
    const insertReservation = (id, connectionId) => db.run(
      `INSERT INTO quotaReservations(
        id, connectionId, provider, routeKeyHash, state, ownerEpoch,
        acquiredAt, dispatchedAt, leaseExpiresAt, lastHeartbeatAt
      ) VALUES(?, ?, 'gemini', ?, 'active', ?, ?, ?, ?, ?)`,
      [
        id,
        connectionId,
        "a".repeat(64),
        "b".repeat(64),
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        new Date(now + 60_000).toISOString(),
        new Date(now).toISOString(),
      ],
    );
    const releaseReservation = (id) => db.run(
      `UPDATE quotaReservations
       SET state='released', terminalAt=?, terminalReason='pre_dispatch'
       WHERE id=?`,
      [new Date(now + 1).toISOString(), id],
    );

    insertReservation("reservation-one", "conn-1");
    await expect(database.deleteProviderConnection("conn-1"))
      .rejects.toMatchObject({ code: "ACTIVE_QUOTA_RESERVATIONS" });
    expect(db.get(`SELECT 1 AS present FROM providerConnections WHERE id='conn-1'`)).toBeTruthy();
    releaseReservation("reservation-one");
    await expect(database.deleteProviderConnection("conn-1")).resolves.toBe(true);

    insertReservation("reservation-two", "conn-2");
    await expect(database.deleteProviderConnectionsByProvider("gemini"))
      .rejects.toMatchObject({ code: "ACTIVE_QUOTA_RESERVATIONS" });
    expect(db.get(`SELECT 1 AS present FROM providerConnections WHERE id='conn-2'`)).toBeTruthy();
    releaseReservation("reservation-two");
    await expect(database.deleteProviderConnectionsByProvider("gemini")).resolves.toBe(1);
  });
});
