import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const OWNER = "a".repeat(64);
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-reservation-portable-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("operational reservation portability", () => {
  it("excludes reservations from export and atomically blocks import while a hold is active", async () => {
    const localDb = await import("@/lib/localDb");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const secret = "sk-deadbeef";
    db.run(`
      INSERT INTO providerConnections(id,provider,authType,name,isActive,data,createdAt,updatedAt)
      VALUES('conn-1','kiro','oauth','Account',1,'{}',?,?)
    `, [new Date(NOW).toISOString(), new Date(NOW).toISOString()]);
    db.run(`
      INSERT INTO apiKeys(id,key,name,isActive,allowedCombos,createdAt)
      VALUES('key-1',?,'Key',1,'[]',?)
    `, [secret, new Date(NOW).toISOString()]);
    db.run(`INSERT INTO apiKeyUsageTotals(apiKeyId,totalTokens,totalCost,totalRequests) VALUES('key-1',0,0,0)`);
    db.run(`
      INSERT INTO providerQuotaSnapshots(
        connectionId,accountKey,resourceKey,dimensionKey,state,limitKind,
        limitValue,usedValue,remainingValue,remainingRatio,unit,resetAt,
        observedAt,staleAt,sourceType,sourceId,metadataJson
      ) VALUES('conn-1','scope:connection','scope:account','requests:session',
        'low','bounded',100,99,1,0.01,'requests',?, ?, ?, 'provider_api','kiro:test:v1','{}')
    `, [new Date(NOW + 60_000).toISOString(), new Date(NOW).toISOString(), new Date(NOW + 60_000).toISOString()]);
    db.run(`
      INSERT INTO quotaFetchStates(
        connectionId,sourceId,outcome,lastObservedAt,attemptedAt,lastSuccessAt
      ) VALUES('conn-1','kiro:test:v1','success',?,?,?)
    `, [new Date(NOW).toISOString(), new Date(NOW).toISOString(), new Date(NOW).toISOString()]);

    const held = await localDb.acquireQuotaReservation({
      connectionId: "conn-1",
      provider: "kiro",
      routeKeyHash: localDb.hashQuotaRoute("kiro/claude-sonnet"),
      ownerEpoch: OWNER,
      alternatives: [[{
        accountKey: "scope:connection",
        resourceKey: "scope:account",
        dimensionKey: "requests:session",
        requiredAmount: 1,
      }]],
      leaseMs: 420_000,
    }, { now: NOW + 1 });
    expect(held.acquired).toBe(true);

    const exported = await localDb.exportDb({ now: NOW + 2 });
    expect(exported).not.toHaveProperty("quotaReservations");
    expect(exported.quota).not.toHaveProperty("reservations");
    expect(JSON.stringify(exported)).not.toContain(held.reservationId);
    expect(exported.apiKeys[0].key).toBe(secret);

    await expect(localDb.importDb(exported, { now: NOW + 3 })).rejects.toThrow("provider requests are active");
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe(secret);
    expect(db.get(`SELECT state FROM quotaReservations WHERE id=?`, [held.reservationId]).state).toBe("active");

    await localDb.releaseQuotaReservation(held.reservationId, "pre_dispatch", { ownerEpoch: OWNER, now: NOW + 4 });
    const restored = await localDb.importDb(exported, { now: NOW + 5 });
    expect(restored.apiKeys[0].key).toBe(secret);
    expect(db.get(`SELECT COUNT(*) AS count FROM quotaReservations`).count).toBe(0);
    expect(db.get(`SELECT COUNT(*) AS count FROM quotaReservationItems`).count).toBe(0);
  });
});
