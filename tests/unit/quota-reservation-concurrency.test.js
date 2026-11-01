import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTrackedWorkers } from "../utils/trackedWorkers.js";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import m007 from "../../src/lib/db/migrations/007-provider-quota-snapshots.js";
import m008 from "../../src/lib/db/migrations/008-quota-reservations.js";

const NOW = "2026-07-10T12:00:00.001Z";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const adapterPath = path.join(repoRoot, "src/lib/db/adapters/betterSqliteAdapter.js");
const reservationRepoPath = path.join(repoRoot, "src/lib/db/repos/quotaReservationsRepo.js");
let tempDir;
const workerPool = createTrackedWorkers();

const workerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const { pathToFileURL } = require("node:url");
  (async () => {
    const { createBetterSqliteAdapter } = await import(pathToFileURL(workerData.adapterPath).href);
    const { acquireQuotaReservationSync } = await import(pathToFileURL(workerData.reservationRepoPath).href);
    const adapter = createBetterSqliteAdapter(workerData.file);
    parentPort.postMessage({ type: "ready" });
    parentPort.once("message", (message) => {
      if (message !== "start") return;
      try {
        const result = acquireQuotaReservationSync(adapter, workerData.request, { now: workerData.now });
        adapter.close();
        parentPort.postMessage({ type: "done", acquired: result.acquired });
      } catch (error) {
        adapter.close();
        parentPort.postMessage({ type: "error", message: error.message });
      }
    });
  })().catch((error) => parentPort.postMessage({ type: "error", message: error.message }));
`;

function rawAdapter(db) {
  return { exec: (sql) => db.exec(sql) };
}

function seed(file, identities) {
  const db = new Database(file);
  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");
  db.exec(`
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta(key, value) VALUES('schemaVersion', '8');
    CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
  `);
  for (const identity of identities) {
    db.prepare(`INSERT OR IGNORE INTO providerConnections(id, provider) VALUES(?, 'kiro')`).run(identity.connectionId);
  }
  m007.up(rawAdapter(db));
  m008.up(rawAdapter(db));
  for (const identity of identities) {
    db.prepare(`
      INSERT INTO providerQuotaSnapshots(
        connectionId, accountKey, resourceKey, dimensionKey, state, limitKind,
        limitValue, usedValue, remainingValue, remainingRatio, unit, resetAt,
        observedAt, staleAt, sourceType, sourceId, metadataJson
      ) VALUES(?, 'scope:connection', 'scope:account', ?, 'low', 'bounded',
        100, 99, 1, 0.01, 'requests', '2026-07-10T13:00:00.000Z',
        '2026-07-10T12:00:00.000Z', '2026-07-10T13:00:00.000Z',
        'provider_api', 'kiro:test:v1', '{}')
    `).run(identity.connectionId, identity.dimensionKey);
  }
  db.close();
}

async function runWorkers(file, identities, workerScript = workerSource) {
  const workers = [];
  try {
    return await new Promise((resolve, reject) => {
      const results = [];
      const completed = new Set();
      let ready = 0;
      identities.forEach((identity, index) => {
        const worker = workerPool.create(workerScript, {
          eval: true,
          execArgv: ["--no-warnings"],
          workerData: {
            adapterPath, reservationRepoPath, file, now: Date.parse(NOW),
            request: {
              connectionId: identity.connectionId, provider: "kiro", routeKeyHash: "a".repeat(64),
              ownerEpoch: `${index.toString(16).padStart(8, "0")}${"b".repeat(56)}`,
              alternatives: [[{
                accountKey: "scope:connection", resourceKey: "scope:account",
                dimensionKey: identity.dimensionKey, requiredAmount: 1,
              }]],
              leaseMs: 600_000,
            },
          },
        });
        workers.push(worker);
        worker.on("error", reject);
        worker.once("exit", (code) => {
          if (!completed.has(worker)) reject(new Error(`Quota worker exited before completion (${code})`));
        });
        worker.on("message", (message) => {
          if (message.type === "error") return reject(new Error(message.message));
          if (message.type === "ready") {
            ready += 1;
            if (ready === identities.length) workers.forEach((candidate) => candidate.postMessage("start"));
          } else if (message.type === "done") {
            completed.add(worker);
            results.push(message.acquired);
            if (completed.size === identities.length) resolve(results);
          }
        });
      });
    });
  } finally {
    await workerPool.close(workers);
  }
}

// A Vitest timeout does not cancel the awaited worker promise. This hook must
// also terminate the live workers, and must finish before deleting their DB.
afterEach(async () => {
  await workerPool.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("quota reservation WAL contention", () => {
  const fixtureIdentity = { connectionId: "fixture", dimensionKey: "requests:session" };

  it("cleans up every worker after a startup failure", async () => {
    await expect(runWorkers("unused", [fixtureIdentity, fixtureIdentity],
      'require("node:worker_threads").parentPort.postMessage({ type: "error", message: "startup fault" });'))
      .rejects.toThrow("startup fault");
    expect(workerPool.size).toBe(0);
  });

  it("cleans up workers when a ready worker throws", async () => {
    await expect(runWorkers("unused", [fixtureIdentity, fixtureIdentity], `
      const { parentPort } = require("node:worker_threads");
      parentPort.postMessage({ type: "ready" });
      parentPort.once("message", () => { throw new Error("after-ready fault"); });
    `)).rejects.toThrow("after-ready fault");
    expect(workerPool.size).toBe(0);
  });

  it("rejects premature exit instead of waiting forever", async () => {
    await expect(runWorkers("unused", [fixtureIdentity], "process.exit(0);"))
      .rejects.toThrow("Quota worker exited before completion");
    expect(workerPool.size).toBe(0);
  });

  it("cleans earlier workers when later construction arguments fail", async () => {
    await expect(runWorkers("unused", [fixtureIdentity, null], "setInterval(() => {}, 1000);"))
      .rejects.toThrow();
    expect(workerPool.size).toBe(0);
  });

  it("allows exactly one of 100 independent writers to acquire the final slot", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-reserve-race-"));
    const file = path.join(tempDir, "quota.sqlite");
    const identity = { connectionId: "conn-1", dimensionKey: "requests:session" };
    seed(file, [identity]);
    const results = await runWorkers(file, Array.from({ length: 100 }, () => identity));
    expect(results.filter(Boolean)).toHaveLength(1);
    const verified = new Database(file, { readonly: true });
    expect(verified.prepare(`SELECT COUNT(*) AS count FROM quotaReservations`).get().count).toBe(1);
    expect(verified.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    verified.close();
  }, 15_000);

  it("does not logically cross-block independent quota identities", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-reserve-independent-"));
    const file = path.join(tempDir, "quota.sqlite");
    const identities = Array.from({ length: 8 }, (_, index) => ({
      connectionId: `conn-${index}`,
      dimensionKey: `requests:window-${index}`,
    }));
    seed(file, identities);
    const results = await runWorkers(file, identities);
    expect(results.every(Boolean)).toBe(true);
  });
});
