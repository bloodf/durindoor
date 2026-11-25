import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readUsageDailyRollups } from "@/lib/db/helpers/usageDailyRollups.js";
import { applyVersionedMigrations } from "@/lib/db/migrate.js";
import migration from "@/lib/db/migrations/037-usage-daily-rollups.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const dateKey = "2026-09-19";
const timestamp = new Date(2026, 8, 19, 12).toISOString();
const now = new Date(2026, 8, 21, 12);
let directory, db, repo;

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "usage-rollup-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  delete global._dbAdapter;
  vi.resetModules();
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/repos/usageRepo.js");
});

afterEach(async () => {
  await disposeLoadedRequestDetailsRepo();
  db?.close();
  delete global._dbAdapter;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function event(i) {
  const cost = i % 3 ? 0.125 : null;
  return {
    timestamp, provider: "fixture", model: `model-${i}`, connectionId: `account-${i}`, endpoint: `/fixture/${i}`,
    apiKey: `fixture-credential-${i}`, tokens: { prompt_tokens: 2, completion_tokens: 3, cached_tokens: 1 },
    latencyMs: 100, ttftMs: 25, cost, status: "ok",
    costStatus: cost === null ? "unknown" : "known", costSource: cost === null ? "unavailable" : "provider",
  };
}

function legacyDay(events) {
  const day = {};
  for (const entry of events) repo.aggregateEntryToDay(day, entry);
  return JSON.parse(JSON.stringify(day));
}

function stageLegacy(adapter, day) {
  adapter.run("INSERT INTO usageDaily(dateKey, data) VALUES (?, ?)", [dateKey, JSON.stringify(day)]);
}

// Measured 10.6-12.1 s alone on a 20-core host (load ~11), 2026-11-25. The cost is inherent,
// not a per-write regression: each event dirties ~28 SQLite pages (10 usageHistory
// indexes plus 4 rollup upserts), so 2,000 commits trip ~100 WAL autocheckpoints at
// 20-40 ms each (~2 s of the ~4 s write phase). The first report also pays ~2.3 s of cold module
// transforms for the repos getUsageStats imports lazily, and the two 2,000-bucket
// report rounds plus migration take ~3 s. The 15 s default flaked under suite load.
it("keeps 2,000 high-cardinality writes flat and preserves legacy stats and charts", async () => {
  const events = Array.from({ length: 2000 }, (_, index) => event(index));
  const legacy = legacyDay(events);
  const { get, run } = db;
  let legacyReads = 0;
  let upserts = 0;
  const parameterCounts = new Set();
  db.get = (sql, params) => {
    if (/FROM usageDaily\b/.test(sql)) legacyReads++;
    return get(sql, params);
  };
  db.run = (sql, params) => {
    if (/INSERT INTO usageDailyRollups\b/.test(sql)) {
      upserts++;
      parameterCounts.add(params.length);
    }
    return run(sql, params);
  };
  const medians = [];
  try {
    for (let offset = 0; offset < events.length; offset += 500) {
      const timings = [];
      for (const entry of events.slice(offset, offset + 500)) {
        const start = performance.now();
        await repo.saveRequestUsage(entry);
        timings.push(performance.now() - start);
      }
      timings.sort((a, b) => a - b);
      medians.push(timings[250]);
    }
  } finally {
    db.get = get;
    db.run = run;
  }
  console.info("Median ms/write across 500-request batches:", medians.map((ms) => ms.toFixed(3)).join(", "));
  expect(Math.max(...medians.slice(1))).toBeLessThan(medians[0] * 2.5);
  expect(legacyReads).toBe(0);
  expect(upserts).toBe(2000);
  expect(parameterCounts.size).toBe(1);

  expect(db.get("SELECT COUNT(*) AS count FROM usageDailyRollups").count).toBe(8002);
  expect([...readUsageDailyRollups(db)]).toEqual([{ dateKey, day: legacy }]);

  vi.useFakeTimers();
  vi.setSystemTime(now);
  const readReports = () => Promise.all([
    repo.getUsageStats("all"),
    repo.getUsageStats("7d"),
    repo.getUsageStats("all", { startDate: dateKey, endDate: dateKey }),
    repo.getChartData("all", "UTC"),
    repo.getChartData("7d", "UTC"),
  ]);
  const reports = await readReports();
  expect(reports[0].totalRequests).toBe(2000);
  expect(Object.keys(reports[0].byModel)).toHaveLength(2000);

  db.transaction(() => {
    db.run("DELETE FROM usageDailyRollups");
    stageLegacy(db, legacy);
    migration.up(db);
  });
  expect(await readReports()).toEqual(reports);
}, 40_000);

it("converts a legacy fixture atomically and can be retried without double-counting", () => {
  const legacy = legacyDay([event(1), event(1), event(2)]);
  stageLegacy(db, legacy);
  db.run("UPDATE _meta SET value = '36' WHERE key = 'schemaVersion'");
  const versions = JSON.parse(db.get("SELECT value FROM _meta WHERE key = 'appliedMigrations'").value);
  db.run("UPDATE _meta SET value = ? WHERE key = 'appliedMigrations'", [JSON.stringify(versions.filter((v) => v !== 37))]);
  db.exec("DROP TABLE usageDailyRollups");

  expect(() => applyVersionedMigrations(db, [{ ...migration, up(adapter) {
    migration.up(adapter);
    throw new Error("fixture failure");
  } }])).toThrow("fixture failure");
  expect(JSON.parse(db.get("SELECT data FROM usageDaily").data)).toEqual(legacy);
  expect(applyVersionedMigrations(db, [migration])).toEqual({ applied: 1, from: 36, to: 37 });
  expect(db.all("SELECT data FROM usageDaily")).toEqual([]);
  expect([...readUsageDailyRollups(db)]).toEqual([{ dateKey, day: legacy }]);
  db.transaction(() => migration.up(db));
  expect([...readUsageDailyRollups(db)]).toEqual([{ dateKey, day: legacy }]);
});

it.skipIf(!process.env.DURINDOOR_TEST_PG_URL)("migrates and increments in a disposable PostgreSQL schema", async () => {
  const { Client } = await import("pg");
  const { createPostgresAdapter } = await import("@/lib/db/adapters/pgAdapter.js");
  const { PG_MIGRATIONS, bootstrapPgMetaTable } = await import("@/lib/db/migrations/postgres/index.js");
  const { incrementUsageDailyRollup } = await import("@/lib/db/helpers/usageDailyRollups.js");
  const connectionString = process.env.DURINDOOR_TEST_PG_URL;
  const schema = `rollup_${process.pid}_${Date.now()}`;
  const client = new Client({ connectionString });
  await client.connect();
  let adapter;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString);
    url.searchParams.set("options", `-c search_path=${schema}`);
    adapter = await createPostgresAdapter({ url: url.toString() });
    bootstrapPgMetaTable(adapter);
    applyVersionedMigrations(adapter, PG_MIGRATIONS.filter((step) => step.version < 37));
    const events = [event(0), event(1)];
    stageLegacy(adapter, legacyDay(events));
    // Construct a blob larger than the sync bridge cap on the server.
    adapter.run("UPDATE usageDaily SET data = data || REPEAT(' ', ?) WHERE dateKey = ?", [8 * 1024 * 1024, dateKey]);
    applyVersionedMigrations(adapter, PG_MIGRATIONS);
    adapter.transaction(() => incrementUsageDailyRollup(adapter, dateKey, legacyDay([events[1]])));
    expect([...readUsageDailyRollups(adapter)]).toEqual([{ dateKey, day: legacyDay([...events, events[1]]) }]);
    expect(adapter.all("SELECT data FROM usageDaily")).toEqual([]);
  } finally {
    await adapter?.close();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
