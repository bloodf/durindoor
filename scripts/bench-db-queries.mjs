#!/usr/bin/env node
// Usage: node scripts/bench-db-queries.mjs [--rows 50000 | --days 365]
//   [--rows-per-day 9500] [--budget-ms 2000] [--iterations 5] [--engine both|sqlite|pg] [--json]
// DURINDOOR_PG_URL optionally selects a disposable PostgreSQL server. Its role
// needs CREATEDB; database durindoor is always refused, even as an admin target.
// Seed/setup/warmup are excluded from timings. Medians enforce the budget.
import { mkdtemp, rm, realpath, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const output = console.log.bind(console);
// Keep machine-readable stdout clean, including repository migration diagnostics.
console.log = console.error.bind(console);

function options(argv) {
  const result = { rows: 50000, days: null, rowsPerDay: 9500, budgetMs: 2000, iterations: 5, engine: "both", json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") result.json = true;
    else if (arg === "--engine") {
      result.engine = argv[++i];
      if (!["both", "sqlite", "pg"].includes(result.engine)) throw new Error("--engine must be both, sqlite, or pg");
    }
    else if (["--rows", "--days", "--rows-per-day", "--budget-ms", "--iterations"].includes(arg)) {
      const n = Number(argv[++i]);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${arg} needs a positive integer`);
      result[({ "--rows-per-day": "rowsPerDay", "--budget-ms": "budgetMs" })[arg] || arg.slice(2)] = n;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (result.days != null) {
    if (argv.includes("--rows")) throw new Error("--rows and --days are mutually exclusive");
    result.rows = result.days * result.rowsPerDay;
    if (!Number.isSafeInteger(result.rows)) throw new Error("Seed row count exceeds safe integer range");
  } else if (argv.includes("--rows-per-day")) throw new Error("--rows-per-day requires --days");
  return result;
}

async function guard() {
  if (process.env.DATA_DIR) {
    const supplied = path.resolve(process.env.DATA_DIR);
    const canonical = await realpath(supplied).catch(() => supplied);
    const protectedPath = "/opt/cortexos/.durindoor";
    if ([supplied, canonical].some((p) => p === protectedPath || p.startsWith(`${protectedPath}/`))) {
      throw new Error("Refusing protected DATA_DIR /opt/cortexos/.durindoor before any database connection");
    }
  }
  if (!process.env.DURINDOOR_PG_URL) return null;
  const url = new URL(process.env.DURINDOOR_PG_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Expected a PostgreSQL URL");
  // An omitted database defaults to the user name in libpq.
  const database = decodeURIComponent(url.pathname.slice(1) || url.username);
  if (!database) throw new Error("PostgreSQL URL must identify a database");
  // pg connection-string query parameters can override the URL path.
  const names = [database, url.searchParams.get("database"), url.searchParams.get("dbname")];
  if (names.includes("durindoor")) {
    throw new Error("Refusing PostgreSQL database durindoor before any database connection");
  }
  return url;
}

const epoch = "2026-01-15T12:00:00.000Z";
function freezeClock() {
  process.env.TZ = "UTC";
  const NativeDate = Date;
  const now = NativeDate.parse(epoch);
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
}

async function seed(db, usage, opts) {
  const { rows, days, rowsPerDay } = opts;
  // Seed representative events through production writes, then replicate their
  // multiplicities in SQL. This avoids millions of JSON read/modify/write cycles
  // during setup without inventing daily-rollup or materialized-view semantics.
  let representatives = days ? Math.min(100, rowsPerDay) : rows;
  while (days && rowsPerDay % representatives !== 0) representatives--;
  const factor = days ? rowsPerDay / representatives : 1;
  const writes = days ? days * representatives : rows;
  let state = 0x51a7c0de;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  db.transaction(() => {
    // Synthetic keys only: a fixed salt makes rollup identities reproducible too.
    db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ["usageIdentitySalt", "51a7c0de".repeat(8)]);
    for (let i = 0; i < 1000; i++) {
      db.run(`INSERT INTO providerConnections(id, provider, authType, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [`connection-${i}`, `provider-${i % 4}`, "apikey", `Connection ${i}`, "{}", epoch, epoch]);
    }
    for (let g = 0; g < 50; g++) {
      db.run(`INSERT INTO connectionGroups(id, name, createdAt, updatedAt) VALUES(?, ?, ?, ?)`, [`group-${g}`, `Group ${String(g).padStart(2, "0")}`, epoch, epoch]);
      for (let m = 0; m < 20; m++) {
        db.run(`INSERT INTO connectionGroupMembers(groupId, connectionId, createdAt) VALUES(?, ?, ?)`, [`group-${g}`, `connection-${g * 20 + m}`, epoch]);
      }
    }
  });
  for (let i = 0; i < writes; i++) {
    const day = days ? Math.floor(i / representatives) : i % 35;
    const dimension = days ? i % 574 : i % 1000;
    const timestamp = new Date(Date.now() - day * 86400000 - Math.floor(random() * 43200000));
    const prompt = 100 + Math.floor(random() * 4000);
    const completion = 10 + Math.floor(random() * 500);
    await usage.saveRequestUsage({ timestamp: timestamp.toISOString(), provider: `provider-${dimension % 4}`, model: `model-${dimension % 8}`, connectionId: `connection-${dimension}`, apiKey: `synthetic-key-${dimension % 8}`, endpoint: "/v1/chat/completions", status: i % 20 ? "ok" : "error", tokens: { prompt_tokens: prompt, completion_tokens: completion, cached_tokens: i % 3 ? 20 : 0 } });
    await usage.recordTokenSaverEvent({ rtk: { requestsWithHits: 1, hits: i % 5, bytesBefore: 4000, bytesAfter: 3000, bytesSaved: 1000 }, headroom: { state: ["compressed", "skipped", "disabled"][i % 3], tokensBefore: prompt, tokensAfter: prompt - 50, tokensSaved: 50, bodyBytesBefore: 4000, bodyBytesAfter: 3800 }, pxpipe: { applied: i % 2, tokensBeforeEst: 100, tokensAfterEst: 80, tokensSavedEst: 20, imageCount: i % 4 } }, timestamp);
    if (days && (i + 1) % (representatives * 30) === 0) console.error(`Seed ${db.driver}: ${Math.floor((i + 1) / representatives)}/${days} days of representatives`);
  }
  if (factor > 1) {
    db.exec("CREATE TEMP TABLE benchCopies (n INTEGER NOT NULL, clock TEXT NOT NULL)");
    db.transaction(() => {
      for (let n = 1; n < factor; n++) {
        const clock = new Date(Date.parse("2026-01-15T00:00:00.000Z") + Math.floor(random() * 43200000)).toISOString().slice(10, 19);
        db.run("INSERT INTO benchCopies(n, clock) VALUES(?, ?)", [n, clock]);
      }
    });
    for (const table of ["usageHistory", "tokenSaverEvents"]) {
      const columns = Object.keys(db.get(`SELECT * FROM ${table} LIMIT 1`)).filter((column) => column !== "id");
      const quoted = columns.map((column) => `"${column}"`).join(", ");
      const sourceMaxId = db.get(`SELECT MAX(id) AS id FROM ${table}`).id;
      // Bounded INSERTs avoid the adapter's per-query deadline on multi-million
      // row fixtures. Pin source ids so later batches cannot replicate replicas.
      for (let copy = 1; copy < factor; copy++) {
        db.run(`INSERT INTO ${table} (${quoted}) SELECT ${columns.map((column) => column === "timestamp" ? `SUBSTR(source.timestamp, 1, 10) || benchCopies.clock || SUBSTR(source.timestamp, 20)` : `source."${column}"`).join(", ")} FROM ${table} AS source CROSS JOIN benchCopies WHERE source.id <= ? AND benchCopies.n = ?`, [sourceMaxId, copy]);
      }
    }
    // The rollup blob is a tree of numeric leaves keyed by dimension. Branch on
    // the shape each case actually handles — finite number, array, object —
    // rather than narrowing a representation with `typeof`.
    const multiply = (value) => {
      if (Number.isFinite(value)) return value * factor;
      if (Array.isArray(value)) return value.map(multiply);
      if (value instanceof Object) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, multiply(item)]));
      }
      return value;
    };
    db.transaction(() => {
      for (const row of db.all("SELECT dateKey, data FROM usageDaily")) {
        db.run("UPDATE usageDaily SET data = ? WHERE dateKey = ?", [JSON.stringify(multiply(JSON.parse(row.data))), row.dateKey]);
      }
      db.run("UPDATE _meta SET value = ? WHERE key = 'totalRequestsLifetime'", [String(rows)]);
    });
    db.exec("DROP TABLE benchCopies");
  }
  // Bulk fixture generation bypasses write-maintained summaries; rebuild using
  // the actual migration, not a benchmark-specific approximation of its schema.
  const migrations = new URL("../src/lib/db/migrations/", import.meta.url);
  const migrationFiles = await readdir(migrations);
  const summaryMigration = migrationFiles.find((name) => name.startsWith("021-") && name.endsWith(".js"));
  if (summaryMigration) (await import(new URL(summaryMigration, migrations))).backfillUsageLastSeen(db);
  if (migrationFiles.includes("token-saver-daily-schema.js")) {
    const { backfillTokenSaverDaily } = await import(new URL("token-saver-daily-schema.js", migrations));
    db.transaction(() => backfillTokenSaverDaily(db));
  }
  for (const table of ["usageHistory", "tokenSaverEvents"]) {
    assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM ${table}`).n), rows, `${table} seed write failed`);
  }
  const distribution = db.get("SELECT MIN(timestamp) AS earliest, MAX(timestamp) AS latest, COUNT(DISTINCT SUBSTR(timestamp, 1, 10)) AS days FROM usageHistory");
  const dimensionCount = Number(db.get("SELECT COUNT(*) AS n FROM (SELECT provider, model, connectionId, apiKey, endpoint FROM usageHistory GROUP BY provider, model, connectionId, apiKey, endpoint) AS dimensions").n);
  if (days) {
    assert.equal(Number(distribution.days), days, "seed must span exactly the requested UTC dates");
    assert.equal(dimensionCount, Math.min(writes, 574), "seed dimension cardinality changed");
  }
  console.error(`Seed verified: ${JSON.stringify({ rowsPerTable: rows, representativeWrites: writes, multiplicity: factor, dimensionCount, ...distribution })}`);
  db.exec("ANALYZE");
  return { rowsPerTable: rows, representativeWrites: writes, multiplicity: factor, dimensionCount, synthetic: true, construction: "Real representative writes; SQL replication with deterministic within-day timestamp jitter; scaled daily aggregates; migration summary backfill", ...distribution };
}

async function measure(engine, db, opts, usage, groups) {
  console.error(`Seeding ${engine}: ${opts.rows} rows per event table, 50 groups x 20 members`);
  const seeded = await seed(db, usage, opts);
  assert.equal((await usage.getTokenSaverStats("all")).requestsObserved, opts.rows);
  const operations = [
    ...["today", "7d", "30d", "all"].map((period) => [`getUsageStats('${period}')`, () => usage.getUsageStats(period)]),
    ...["7d", "all"].map((period) => [`getTokenSaverStats('${period}')`, () => usage.getTokenSaverStats(period)]),
    ...["7d", "all"].map((period) => [`getChartData('${period}')`, () => usage.getChartData(period)]),
    // The baseline history route delegates to full stats; the candidate replaces
    // that dependency with a bounded SQL page. These are repository-path timings,
    // not HTTP/browser timings (no network, authentication, or rendering included).
    ["history(limit=50)", async () => {
      if (!usage.listUsageHistoryPage) return usage.getUsageStats("all");
      const page = await usage.listUsageHistoryPage({ limit: 50, offset: 0, filters: {} });
      assert.equal(page.rows.length, Math.min(50, opts.rows), "history page must remain bounded");
      assert.equal(page.total, opts.rows, "history total must count the full seed");
      return page;
    }],
    ["getConnectionGroups()", () => groups.getConnectionGroups()],
  ];
  const results = [];
  for (const [operation, run] of operations) {
    await run(); // One untimed warmup; all recorded samples are warm-cache calls.
    const samples = [];
    for (let n = 0; n < opts.iterations; n++) {
      const start = performance.now();
      await run();
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    results.push({ engine, driver: db.driver, operation, min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, p95: sorted[Math.ceil(sorted.length * 0.95) - 1], samples });
    console.error(`${engine} ${operation}: median=${results.at(-1).median.toFixed(3)}ms`);
  }
  return { results, seeded };
}

async function main() {
  const opts = options(process.argv.slice(2));
  const pgUrl = await guard(); // No imports with DB side effects before guards.
  if (opts.engine === "pg" && !pgUrl) throw new Error("--engine pg requires DURINDOOR_PG_URL");
  const dir = await mkdtemp(path.join(tmpdir(), "durindoor-bench-"));
  process.env.DATA_DIR = dir;
  freezeClock();
  register(new URL("./alias-loader.mjs", import.meta.url));
  let db;
  let admin;
  let scratch;
  try {
    const driver = await import("../src/lib/db/driver.js");
    const { runMigrationOnce } = await import("../src/lib/db/migrate.js");
    const usage = await import("../src/lib/db/repos/usageRepo.js");
    const groups = await import("../src/lib/db/repos/connectionGroupsRepo.js");
    const results = [];
    const seeds = {};
    if (opts.engine !== "pg") {
      db = await driver.openSqliteAdapter(path.join(dir, "data.sqlite"));
      driver.setActiveAdapter(db);
      await runMigrationOnce(db);
      const sqlite = await measure("SQLite", db, opts, usage, groups);
      results.push(...sqlite.results);
      seeds.SQLite = sqlite.seeded;
    }
    let postgresError = null;
    if (pgUrl && opts.engine !== "sqlite") {
      try {
        const { Client } = await import("pg");
        admin = new Client({ connectionString: pgUrl.href });
        await admin.connect();
        const name = `durindoor_bench_${randomUUID().replaceAll("-", "")}`;
        await admin.query(`CREATE DATABASE "${name}"`);
        scratch = name; // Only drop a database this invocation successfully created.
        const isolated = new URL(pgUrl);
        isolated.pathname = `/${scratch}`;
        isolated.searchParams.delete("database");
        isolated.searchParams.delete("dbname");
        await db?.close();
        const { createPostgresAdapter } = await import("../src/lib/db/adapters/pgAdapter.js");
        const pg = await createPostgresAdapter({ url: isolated.href });
        driver.setActiveAdapter(pg);
        db = pg;
        await runMigrationOnce(db);
        const measured = await measure("PostgreSQL", db, opts, usage, groups);
        results.push(...measured.results);
        seeds.PostgreSQL = measured.seeded;
      } catch (error) {
        postgresError = error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted PostgreSQL URL]");
        console.error(`PostgreSQL benchmark unavailable: ${postgresError}. Completed measurements are retained.`);
        // Requested PG verification failed: preserve useful output without a false green.
        process.exitCode = 1;
      }
    } else {
      console.error(`PostgreSQL skipped: ${opts.engine === "sqlite" ? "--engine sqlite selected" : "DURINDOOR_PG_URL is not set"}.`);
    }
    const overBudget = results.filter((r) => r.median > opts.budgetMs);
    for (const r of overBudget) console.error(`OVER BUDGET: ${r.engine} ${r.operation}: median ${r.median.toFixed(3)}ms > ${opts.budgetMs}ms`);
    if (overBudget.length) process.exitCode = 1;
    else if (!postgresError) console.error(`PASS: all measured medians <= ${opts.budgetMs}ms`);
    if (opts.json) output(JSON.stringify({ rowsPerTable: opts.rows, days: opts.days, rowsPerDay: opts.days ? opts.rowsPerDay : null, seeds, budgetMs: opts.budgetMs, overBudget: overBudget.map(({ engine, operation, median }) => ({ engine, operation, median })), iterations: opts.iterations, seed: "0x51a7c0de", now: epoch, timezone: "UTC", warmupIterations: 1, postgresSkipped: !pgUrl || opts.engine === "sqlite", postgresError, unit: "ms", results }, null, 2));
    else {
      output(`Rows per event table: ${opts.rows}; days: ${opts.days || "legacy 35-day distribution"}; rows/day: ${opts.days ? opts.rowsPerDay : "variable"}; iterations: ${opts.iterations}; budget: ${opts.budgetMs}ms; fixed clock: ${epoch}; UTC; one warmup; milliseconds.\n`);
      for (const [engine, seed] of Object.entries(seeds)) output(`${engine} synthetic fixture: ${JSON.stringify(seed)}\n`);
      output("| Engine (driver) | Operation | Min (ms) | Median (ms) | p95 (ms) |\n| --- | --- | ---: | ---: | ---: |");
      for (const r of results) output(`| ${r.engine} (${r.driver}) | ${r.operation} | ${r.min.toFixed(3)} | ${r.median.toFixed(3)} | ${r.p95.toFixed(3)} |`);
    }
  } finally {
    try { await db?.close(); } finally {
      try {
        // A timed-out worker query may outlive adapter.close(); FORCE terminates
        // only sessions in this invocation's randomly named disposable database.
        if (scratch) await admin.query(`DROP DATABASE "${scratch}" WITH (FORCE)`);
      } finally {
        try { await admin?.end(); } finally { await rm(dir, { recursive: true, force: true }); }
      }
    }
  }
}

main().catch((error) => {
  // Do not print connection strings or driver errors that may contain credentials.
  console.error(`Benchmark failed: ${error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted PostgreSQL URL]")}`);
  process.exitCode = 1;
});
