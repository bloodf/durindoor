#!/usr/bin/env node
// Usage: node scripts/bench-db-queries.mjs [--rows 50000] [--iterations 5] [--json]
// Set DURINDOOR_PG_URL to additionally benchmark PostgreSQL. Its role needs
// CREATEDB; only a randomly named scratch database receives migrations/data.
// --allow-prod permits using database "durindoor" as the administrative connection,
// NOT benchmarking or modifying its tables. Seed/setup/warmup are not timed.
import { mkdtemp, rm, realpath } from "node:fs/promises";
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
  const result = { rows: 50000, iterations: 5, json: false, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") result.json = true;
    else if (arg === "--allow-prod") result.allowProd = true;
    else if (arg === "--rows" || arg === "--iterations") {
      const n = Number(argv[++i]);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${arg} needs a positive integer`);
      result[arg.slice(2)] = n;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

async function guard(opts) {
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
  if (names.includes("durindoor") && !opts.allowProd) {
    throw new Error("Refusing PostgreSQL database durindoor without --allow-prod before any database connection");
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

async function seed(db, usage, rows) {
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
  // Exercise real write paths so daily rollups and any newly materialized metrics
  // use exactly production normalization, not a benchmark's imitation of it.
  for (let i = 0; i < rows; i++) {
    const day = i % 35;
    const timestamp = new Date(Date.now() - day * 86400000 - Math.floor(random() * 43200000));
    const prompt = 100 + Math.floor(random() * 4000);
    const completion = 10 + Math.floor(random() * 500);
    await usage.saveRequestUsage({ timestamp: timestamp.toISOString(), provider: `provider-${i % 4}`, model: `model-${i % 8}`, connectionId: `connection-${i % 1000}`, apiKey: `synthetic-key-${i % 8}`, endpoint: "/v1/chat/completions", status: i % 20 ? "ok" : "error", tokens: { prompt_tokens: prompt, completion_tokens: completion, cached_tokens: i % 3 ? 20 : 0 } });
    await usage.recordTokenSaverEvent({ rtk: { requestsWithHits: 1, hits: i % 5, bytesBefore: 4000, bytesAfter: 3000, bytesSaved: 1000 }, headroom: { state: ["compressed", "skipped", "disabled"][i % 3], tokensBefore: prompt, tokensAfter: prompt - 50, tokensSaved: 50, bodyBytesBefore: 4000, bodyBytesAfter: 3800 }, pxpipe: { applied: i % 2, tokensBeforeEst: 100, tokensAfterEst: 80, tokensSavedEst: 20, imageCount: i % 4 } }, timestamp);
  }
  for (const table of ["usageHistory", "tokenSaverEvents"]) {
    assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM ${table}`).n), rows, `${table} seed write failed`);
  }
  db.exec("ANALYZE");
}

async function measure(engine, db, opts, usage, groups) {
  console.error(`Seeding ${engine}: ${opts.rows} rows per event table, 50 groups x 20 members`);
  await seed(db, usage, opts.rows);
  assert.equal((await usage.getTokenSaverStats("all")).requestsObserved, opts.rows);
  const operations = [
    ...["today", "7d", "30d"].map((period) => [`getUsageStats('${period}')`, () => usage.getUsageStats(period)]),
    ...["7d", "all"].map((period) => [`getTokenSaverStats('${period}')`, () => usage.getTokenSaverStats(period)]),
    ["getChartData('7d')", () => usage.getChartData("7d")],
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
  }
  return results;
}

async function main() {
  const opts = options(process.argv.slice(2));
  const pgUrl = await guard(opts); // No imports with DB side effects before guards.
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
    db = await driver.openSqliteAdapter(path.join(dir, "data.sqlite"));
    driver.setActiveAdapter(db);
    await runMigrationOnce(db);
    const results = await measure("SQLite", db, opts, usage, groups);
    let postgresError = null;
    if (pgUrl) {
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
        const { createPostgresAdapter } = await import("../src/lib/db/adapters/pgAdapter.js");
        const pg = await createPostgresAdapter({ url: isolated.href });
        driver.setActiveAdapter(pg);
        db = pg;
        await runMigrationOnce(db);
        results.push(...await measure("PostgreSQL", db, opts, usage, groups));
      } catch (error) {
        postgresError = error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted PostgreSQL URL]");
        console.error(`PostgreSQL benchmark unavailable: ${postgresError}. SQLite results are retained.`);
        // Requested PG verification failed: preserve useful output without a false green.
        process.exitCode = 1;
      }
    } else {
      console.error("PostgreSQL skipped: DURINDOOR_PG_URL is not set (SQLite benchmark completed).");
    }
    if (opts.json) output(JSON.stringify({ rowsPerTable: opts.rows, iterations: opts.iterations, seed: "0x51a7c0de", now: epoch, timezone: "UTC", warmupIterations: 1, postgresSkipped: !pgUrl, postgresError, unit: "ms", results }, null, 2));
    else {
      output(`Rows per event table: ${opts.rows}; iterations: ${opts.iterations}; fixed clock: ${epoch}; UTC; one warmup; milliseconds.\n`);
      output("| Engine (driver) | Operation | Min (ms) | Median (ms) | p95 (ms) |\n| --- | --- | ---: | ---: | ---: |");
      for (const r of results) output(`| ${r.engine} (${r.driver}) | ${r.operation} | ${r.min.toFixed(3)} | ${r.median.toFixed(3)} | ${r.p95.toFixed(3)} |`);
    }
  } finally {
    try { await db?.close(); } finally {
      try {
        if (scratch) await admin.query(`DROP DATABASE "${scratch}"`);
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
