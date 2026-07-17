import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import m007 from "../../src/lib/db/migrations/007-provider-quota-snapshots.js";
import {
  FETCH_SUCCESS_UPSERT_SQL,
  PROVIDER_QUOTA_SNAPSHOT_UPSERT_SQL,
} from "../../src/lib/db/repos/quotaSnapshotsRepo.js";
import { QUOTA_WRITE_LOCK_SQL } from "../../src/lib/db/repos/quotaSql.js";

const require = createRequire(import.meta.url);
const betterSqlitePath = require.resolve("better-sqlite3");
const workerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const Database = require(workerData.betterSqlitePath);
  try {
    const db = new Database(workerData.file);
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");
    db.pragma("busy_timeout=5000");
    const statement = db.prepare(workerData.sql);
    parentPort.postMessage({ type: "ready" });
    parentPort.once("message", (message) => {
      if (message !== "start") return;
      try {
        for (const values of workerData.writes) statement.run(values);
        db.close();
        parentPort.postMessage({ type: "done" });
      } catch (error) {
        parentPort.postMessage({ type: "error", message: error.message });
      }
    });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error.message });
  }
`;

const replacementWorkerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const Database = require(workerData.betterSqlitePath);
  try {
    const db = new Database(workerData.file);
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");
    db.pragma("busy_timeout=5000");
    const lock = db.prepare(workerData.lockSql);
    const readState = db.prepare("SELECT lastObservedAt FROM quotaFetchStates WHERE connectionId=? AND sourceId=?");
    const clear = db.prepare("DELETE FROM providerQuotaSnapshots WHERE connectionId=? AND sourceId=?");
    const insert = db.prepare(workerData.snapshotSql);
    const success = db.prepare(workerData.successSql);
    const replace = db.transaction((write) => {
      lock.run();
      const prior = readState.get(write.connectionId, write.sourceId);
      if (!prior?.lastObservedAt || write.observedAt > prior.lastObservedAt) {
        clear.run(write.connectionId, write.sourceId);
        insert.run(write.snapshotParams);
      }
      success.run(write.connectionId, write.sourceId, write.observedAt, write.observedAt, write.observedAt);
    });
    parentPort.postMessage({ type: "ready" });
    parentPort.once("message", (message) => {
      if (message !== "start") return;
      try {
        for (const write of workerData.writes) replace(write);
        db.close();
        parentPort.postMessage({ type: "done" });
      } catch (error) {
        parentPort.postMessage({ type: "error", message: error.message });
      }
    });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error.message });
  }
`;

let tempDir;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function rawAdapter(db) {
  return { exec: (sql) => db.exec(sql) };
}

function params({ dimensionKey = "requests:shared", sequence, sourceId = "test:concurrency:v1" }) {
  const observedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
  const staleAt = new Date(Date.UTC(2026, 0, 1, 1, 0, sequence)).toISOString();
  return [
    "conn-1", "scope:connection", "scope:account", dimensionKey,
    sequence === 0 ? "exhausted" : "available", "bounded",
    100, 100 - sequence, sequence, sequence / 100, "requests",
    null, null, observedAt, staleAt, "provider_api", sourceId, null, "{}",
  ];
}

async function runWorkers(workers) {
  await new Promise((resolve, reject) => {
    let ready = 0;
    let done = 0;
    let settled = false;
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    for (const worker of workers) {
      worker.on("error", finishError);
      worker.on("exit", (code) => {
        if (!settled && code !== 0) finishError(new Error(`quota writer exited ${code}`));
      });
      worker.on("message", (message) => {
        if (message.type === "error") {
          finishError(new Error(message.message));
          return;
        }
        if (message.type === "ready") {
          ready += 1;
          if (ready === workers.length) workers.forEach((candidate) => candidate.postMessage("start"));
          return;
        }
        if (message.type === "done") {
          done += 1;
          if (done === workers.length && !settled) {
            settled = true;
            resolve();
          }
        }
      });
    }
  });
  await Promise.all(workers.map((worker) => worker.terminate()));
}

describe("provider quota snapshot database contention", () => {
  it("keeps exactly one newest row per identity across independent WAL writers", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-concurrency-"));
    const file = path.join(tempDir, "quota.sqlite");
    const db = new Database(file);
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");
    db.pragma("busy_timeout=5000");
    db.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    db.exec(`INSERT INTO providerConnections(id, provider) VALUES('conn-1', 'gemini')`);
    m007.up(rawAdapter(db));
    db.close();

    const sequences = Array.from({ length: 100 }, (_, index) => index);
    const chunks = Array.from({ length: 4 }, (_, workerIndex) => sequences
      .filter((sequence) => sequence % 4 === workerIndex)
      .reverse()
      .map((sequence) => params({ sequence }))
      .concat([params({ dimensionKey: `requests:worker-${workerIndex}`, sequence: workerIndex + 1 })]));
    const workers = chunks.map((writes) => new Worker(workerSource, {
      eval: true,
      workerData: { betterSqlitePath, file, sql: PROVIDER_QUOTA_SNAPSHOT_UPSERT_SQL, writes },
    }));
    await runWorkers(workers);

    const verified = new Database(file, { readonly: true });
    const shared = verified.prepare(`SELECT observedAt, remainingValue FROM providerQuotaSnapshots WHERE dimensionKey='requests:shared'`).get();
    expect(shared).toEqual({
      observedAt: "2026-01-01T00:01:39.000Z",
      remainingValue: 99,
    });
    expect(verified.prepare(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).get().count).toBe(5);
    expect(verified.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    verified.close();
  });

  it("serializes whole-source replacements across independent WAL writers", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-source-concurrency-"));
    const file = path.join(tempDir, "quota.sqlite");
    const db = new Database(file);
    db.pragma("journal_mode=WAL");
    db.pragma("foreign_keys=ON");
    db.pragma("busy_timeout=5000");
    db.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      INSERT INTO providerConnections(id, provider) VALUES('conn-1', 'gemini');
    `);
    m007.up(rawAdapter(db));
    db.close();

    const sourceId = "gemini:quota:v1";
    const writes = Array.from({ length: 80 }, (_, sequence) => {
      const observedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
      return {
        connectionId: "conn-1",
        sourceId,
        observedAt,
        snapshotParams: params({ sequence, sourceId }),
      };
    });
    const chunks = Array.from({ length: 4 }, (_, workerIndex) => writes
      .filter((_write, sequence) => sequence % 4 === workerIndex)
      .reverse());
    const workers = chunks.map((workerWrites) => new Worker(replacementWorkerSource, {
      eval: true,
      workerData: {
        betterSqlitePath,
        file,
        lockSql: QUOTA_WRITE_LOCK_SQL,
        snapshotSql: PROVIDER_QUOTA_SNAPSHOT_UPSERT_SQL,
        successSql: FETCH_SUCCESS_UPSERT_SQL,
        writes: workerWrites,
      },
    }));
    await runWorkers(workers);

    const verified = new Database(file, { readonly: true });
    expect(verified.prepare(`SELECT observedAt, remainingValue FROM providerQuotaSnapshots`).get()).toEqual({
      observedAt: "2026-01-01T00:01:19.000Z",
      remainingValue: 79,
    });
    expect(verified.prepare(`SELECT lastObservedAt, attemptedAt, outcome FROM quotaFetchStates`).get()).toEqual({
      lastObservedAt: "2026-01-01T00:01:19.000Z",
      attemptedAt: "2026-01-01T00:01:19.000Z",
      outcome: "success",
    });
    verified.close();
  });
});
