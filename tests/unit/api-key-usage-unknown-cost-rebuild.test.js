import { afterEach, describe, expect, it } from "vitest";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import { rewriteSqliteDml } from "../../src/lib/db/dialects/postgres/dmlRewrite.js";
import { backfillApiKeyUsageTotals } from "../../src/lib/db/helpers/apiKeyUsageTotals.js";
import { ensureAndBackfillApiKeyUsageTotals } from "../../src/lib/db/migrations/apiKeyUsageTotalsBackfill.js";
import migration028 from "../../src/lib/db/migrations/028-usage-unknown-cost-repair.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

// Regression contract for issue #1655: rebuilding per-key lifetime totals from
// retained usage history must preserve the durable unknown-cost count.
//
// Source anchors (base f0c21bf6, PR #1653 head eb5b52f5):
//   src/lib/db/helpers/apiKeyUsageTotals.js                     rebuild helper
//   src/lib/db/migrations/apiKeyUsageTotalsBackfill.js           legacy rebuild
//   src/lib/db/migrations/026-usage-unknown-cost.js:29-47         canonical predicate
//   src/lib/db/migrations/028-usage-unknown-cost-repair.js        forward repair
//   src/lib/db/repos/apiKeyUsageTotalsRepo.js:67-92              runtime increment
//   src/lib/db/repos/usageRepo.js:832                             runtime predicate
//   src/lib/db/repos/usageRepo.js:1955,2004                       history pruning
//   src/lib/db/index.js:538                                       restore detaches
//   src/lib/db/dialects/postgres/dmlRewrite.js:122-153            INSERT OR REPLACE
//
// The durable unknown-cost counter is a lifetime value. Retained history is a
// lower bound on it, never an exact reconstruction, so a rebuild may raise the
// count to the reconstructed bound and must never lower it. The other three
// totals keep the helper's existing replace semantics, which the regression in
// tests/unit/api-key-committed-tokens.test.js pins.

const SECRET = "sk-rebuild-unknown-cost";
const NOW = "2026-01-03T00:00:00.000Z";

const openDbs = [];

afterEach(() => {
  while (openDbs.length) {
    const db = openDbs.pop();
    try { db.close(); } catch { /* already closed */ }
  }
});

/**
 * A real production SQLite adapter over the current declarative schema.
 */
function freshDb() {
  const db = createBetterSqliteAdapter(":memory:");
  openDbs.push(db);
  for (const name of ["apiKeys", "usageHistory", "apiKeyUsageTotals"]) {
    db.exec(buildCreateTableSql(name, TABLES[name]));
  }
  return db;
}

/**
 * An artificial minimal schema. This models a hand-built shape, not a
 * supported installed-schema upgrade: no tracked release shipped a history
 * table without provider and status.
 */
function minimalDb({ totals = "modern", history = "attributed" } = {}) {
  const db = createBetterSqliteAdapter(":memory:");
  openDbs.push(db);
  db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT, name TEXT)`);
  db.exec(history === "attributed"
    ? `CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, provider TEXT, status TEXT, apiKey TEXT, promptTokens INTEGER, completionTokens INTEGER, cost REAL, tokens TEXT, meta TEXT)`
    : `CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, apiKey TEXT, promptTokens INTEGER, completionTokens INTEGER, cost REAL, tokens TEXT, meta TEXT)`);
  db.exec(totals === "modern"
    ? `CREATE TABLE apiKeyUsageTotals (apiKeyId TEXT PRIMARY KEY, totalTokens INTEGER NOT NULL DEFAULT 0, totalCost REAL NOT NULL DEFAULT 0, totalRequests INTEGER NOT NULL DEFAULT 0, unknownCostRequests INTEGER NOT NULL DEFAULT 0, updatedAt TEXT)`
    : `CREATE TABLE apiKeyUsageTotals (apiKeyId TEXT PRIMARY KEY, totalTokens INTEGER NOT NULL DEFAULT 0, totalCost REAL NOT NULL DEFAULT 0, totalRequests INTEGER NOT NULL DEFAULT 0, updatedAt TEXT)`);
  return db;
}

/**
 * Wraps an adapter so the emitted statements can be inspected.
 */
function recording(db) {
  const statements = [];
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "run") {
        return (sql, params) => {
          statements.push(sql);
          return target.run(sql, params);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy, statements };
}

function insertKey(db, id, secret = SECRET) {
  db.run(
    `INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt)
     VALUES(?, ?, 'Key', 1, '[]', '2026-01-01T00:00:00.000Z')`,
    [id, secret],
  );
}

function insertMinimalKey(db, id, secret = SECRET) {
  db.run(`INSERT INTO apiKeys(id, key, name) VALUES(?, ?, 'Key')`, [id, secret]);
}

function insertHistory(db, {
  secret = SECRET,
  cost = null,
  provider = "openai",
  status = "ok",
  meta = "{}",
  tokens = "{}",
  timestamp = "2026-01-02T00:00:00.000Z",
} = {}) {
  db.run(
    `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
     VALUES(?, ?, 'gpt', ?, 0, 0, ?, ?, ?, ?)`,
    [timestamp, provider, secret, cost, status, tokens, meta],
  );
}

function setTotals(db, id, { totalTokens = 0, totalCost = 0, totalRequests = 0, unknownCostRequests = 0, updatedAt = NOW } = {}) {
  db.run(
    `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)`,
    [id, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt],
  );
}

function totalsRow(db, id) {
  return db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [id]);
}

function unknownCount(db, id) {
  const row = totalsRow(db, id);
  return row ? Number(row.unknownCostRequests) : null;
}

describe("API-key usage rebuild: unknown-cost count preservation", () => {
  describe("rebuild helper over the current schema", () => {
    it("reconstructs the count when the durable totals row is missing", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });

      backfillApiKeyUsageTotals(db);

      const row = totalsRow(db, "key-1");
      expect(row).toBeTruthy();
      expect(Number(row.unknownCostRequests)).toBe(1);
      expect(Number(row.totalRequests)).toBe(1);
      expect(Number(row.totalCost)).toBe(0);
    });

    it("reconstructs the count through the legacy replacement rebuild", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });

      ensureAndBackfillApiKeyUsageTotals(db);

      const row = totalsRow(db, "key-1");
      expect(row).toBeTruthy();
      expect(Number(row.unknownCostRequests)).toBe(1);
      expect(Number(row.totalRequests)).toBe(1);
    });

    it("exempts the exact failed MCP pair from both rebuild paths", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null, provider: "mcp-gateway", status: "error" });

      backfillApiKeyUsageTotals(db);
      expect(unknownCount(db, "key-1")).toBe(0);
      expect(Number(totalsRow(db, "key-1").totalRequests)).toBe(0);

      db.run(`DELETE FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`);
      ensureAndBackfillApiKeyUsageTotals(db);
      expect(unknownCount(db, "key-1")).toBe(0);
      expect(Number(totalsRow(db, "key-1").totalRequests)).toBe(0);
    });

    it.each([
      ["another provider's error", { provider: "openai", status: "error" }],
      ["a row with no provider and no status", { provider: null, status: null }],
    ])("counts %s as an unknown-cost request", (_label, shape) => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null, ...shape });

      backfillApiKeyUsageTotals(db);

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("counts a legacy numeric row whose metadata marks the cost unknown", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: 0, meta: JSON.stringify({ costStatus: "unknown" }) });

      backfillApiKeyUsageTotals(db);

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("counts a NULL-cost row that also carries unknown metadata exactly once", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null, meta: JSON.stringify({ costStatus: "unknown" }) });

      backfillApiKeyUsageTotals(db);

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("tolerates malformed metadata and counts it as priced", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null, meta: "{broken" });
      insertHistory(db, { cost: 1.25, meta: "{broken" });

      expect(() => backfillApiKeyUsageTotals(db)).not.toThrow();
      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it.each([
      ["a provider case variant", { provider: "MCP-Gateway", status: "error" }],
      ["a status whitespace variant", { provider: "mcp-gateway", status: " error" }],
      ["a near-miss provider name", { provider: "mcp-gateway-x", status: "error" }],
    ])("counts %s as an unknown-cost request", (_label, shape) => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null, ...shape });

      backfillApiKeyUsageTotals(db);

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("never lowers a durable count that exceeds the retained history", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      setTotals(db, "key-1", { totalRequests: 9, unknownCostRequests: 5 });

      backfillApiKeyUsageTotals(db);
      expect(unknownCount(db, "key-1")).toBe(5);

      backfillApiKeyUsageTotals(db, { overwrite: true });
      expect(unknownCount(db, "key-1")).toBe(5);
    });

    it("keeps the reconstructed count when retained history is later truncated", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });

      backfillApiKeyUsageTotals(db);
      expect(unknownCount(db, "key-1")).toBe(1);

      // Retention pruning and a full history reset delete rows without
      // touching the durable per-key totals.
      db.run(`DELETE FROM usageHistory`);
      backfillApiKeyUsageTotals(db, { overwrite: true });

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("keeps a durable count that no retained history row can explain", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      // A restored backup carries durable totals without the history that
      // produced them.
      setTotals(db, "key-1", { totalTokens: 40, totalCost: 1.5, totalRequests: 12, unknownCostRequests: 7 });

      backfillApiKeyUsageTotals(db, { overwrite: true });

      expect(unknownCount(db, "key-1")).toBe(7);
      expect(Number(totalsRow(db, "key-1").totalRequests)).toBe(0);
    });

    it("does not attribute history rows that carry no API key", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { secret: null, cost: null });

      backfillApiKeyUsageTotals(db, { overwrite: true });

      expect(unknownCount(db, "key-1")).toBe(0);
    });

    it("is idempotent across repeated rebuilds", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });

      backfillApiKeyUsageTotals(db);
      const afterFirst = unknownCount(db, "key-1");
      backfillApiKeyUsageTotals(db);
      expect(unknownCount(db, "key-1")).toBe(afterFirst);
      backfillApiKeyUsageTotals(db, { overwrite: true });
      expect(unknownCount(db, "key-1")).toBe(afterFirst);

      ensureAndBackfillApiKeyUsageTotals(db);
      const afterLegacy = unknownCount(db, "key-1");
      ensureAndBackfillApiKeyUsageTotals(db);
      expect(unknownCount(db, "key-1")).toBe(afterLegacy);
    });
  });

  describe("artificial minimal schemas", () => {
    it("rebuilds a totals table without the unknown-cost column and leaves the schema untouched", () => {
      const db = minimalDb({ totals: "legacy" });
      db.run(`INSERT INTO apiKeys(id, key, name) VALUES('key-1', '${SECRET}', 'Key')`);
      db.run(`INSERT INTO usageHistory(timestamp, provider, status, apiKey, promptTokens, completionTokens, cost, tokens, meta)
              VALUES('2026-01-02T00:00:00.000Z', 'openai', 'ok', '${SECRET}', 0, 0, NULL, '{}', '{}')`);
      const { db: recorder, statements } = recording(db);

      expect(() => backfillApiKeyUsageTotals(recorder)).not.toThrow();

      const write = statements.find((sql) => /INSERT INTO apiKeyUsageTotals/i.test(sql));
      expect(write).toBeTruthy();
      expect(write).not.toMatch(/unknownCostRequests/i);
      expect(db.get(`SELECT totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`).totalRequests).toBe(1);
      expect(db.all(`PRAGMA table_info(apiKeyUsageTotals)`).map((column) => column.name)).not.toContain("unknownCostRequests");
    });

    it("rebuilds a history table without provider and status without failing", () => {
      const db = minimalDb({ history: "plain" });
      db.run(`INSERT INTO apiKeys(id, key, name) VALUES('key-1', '${SECRET}', 'Key')`);
      db.run(`INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, cost, tokens, meta)
              VALUES('2026-01-02T00:00:00.000Z', '${SECRET}', 0, 0, NULL, '{}', '{}')`);

      expect(() => backfillApiKeyUsageTotals(db)).not.toThrow();
      expect(db.get(`SELECT totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`).totalRequests).toBe(1);
    });

    it("keeps the count when the history table has no provider and status columns", () => {
      const db = minimalDb({ history: "plain" });
      db.run(`INSERT INTO apiKeys(id, key, name) VALUES('key-1', '${SECRET}', 'Key')`);
      db.run(`INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, cost, tokens, meta)
              VALUES('2026-01-02T00:00:00.000Z', '${SECRET}', 0, 0, NULL, '{}', '{}')`);

      backfillApiKeyUsageTotals(db);

      expect(db.get(`SELECT unknownCostRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`).unknownCostRequests).toBe(1);
    });

    it("writes the count with a monotonic upsert", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      const { db: recorder, statements } = recording(db);

      backfillApiKeyUsageTotals(recorder);
      const fill = statements.find((sql) => /INSERT INTO apiKeyUsageTotals/i.test(sql));
      expect(fill).toBeTruthy();
      expect(fill).toMatch(/unknownCostRequests/i);

      backfillApiKeyUsageTotals(recorder, { overwrite: true });
      const overwrite = statements.filter((sql) => /INSERT INTO apiKeyUsageTotals/i.test(sql)).pop();
      expect(overwrite).toMatch(/unknownCostRequests/i);
      expect(overwrite).toMatch(/MAX\s*\(|CASE\s+WHEN/i);
    });

    it("writes the legacy replacement as an upsert both engines agree on", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      const { db: recorder, statements } = recording(db);

      ensureAndBackfillApiKeyUsageTotals(recorder);

      const write = statements.find((sql) => /INTO apiKeyUsageTotals/i.test(sql));
      expect(write).toBeTruthy();
      expect(write).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
      expect(write).toMatch(/ON\s+CONFLICT/i);
      expect(write).toMatch(/unknownCostRequests/i);
      expect(write).toMatch(/MAX\s*\(|CASE\s+WHEN/i);
    });

    it("resets an omitted column to its default on SQLite (control for the legacy replacement)", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 5 });

      db.run(
        `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt)
         VALUES('key-1', 0, 0, 1, '${NOW}')`,
      );

      expect(unknownCount(db, "key-1")).toBe(0);
    });
  });

  describe("migration 028 repairs the durable count", () => {
    it("raises a lost count to the reconstructed bound", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 0 });

      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("never lowers a larger durable count", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      setTotals(db, "key-1", { totalRequests: 9, unknownCostRequests: 5 });

      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(5);
    });

    it("leaves the token, cost and request totals untouched", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      setTotals(db, "key-1", { totalTokens: 40, totalCost: 1.5, totalRequests: 12, unknownCostRequests: 0 });

      migration028.up(db);

      const row = totalsRow(db, "key-1");
      expect(Number(row.totalTokens)).toBe(40);
      expect(Number(row.totalCost)).toBe(1.5);
      expect(Number(row.totalRequests)).toBe(12);
      expect(Number(row.unknownCostRequests)).toBe(1);
    });

    it("is idempotent", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 0 });

      migration028.up(db);
      const afterFirst = unknownCount(db, "key-1");
      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(afterFirst);
    });

    it("skips when the durable column is absent", () => {
      const db = minimalDb({ totals: "legacy" });
      insertMinimalKey(db, "key-1");
      db.run(`INSERT INTO usageHistory(timestamp, provider, status, apiKey, promptTokens, completionTokens, cost, tokens, meta)
              VALUES('2026-01-02T00:00:00.000Z', 'openai', 'ok', '${SECRET}', 0, 0, NULL, '{}', '{}')`);

      expect(() => migration028.up(db)).not.toThrow();
      expect(db.all(`PRAGMA table_info(apiKeyUsageTotals)`).map((column) => column.name)).not.toContain("unknownCostRequests");
    });

    it("exempts the exact failed MCP pair", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null, provider: "mcp-gateway", status: "error" });
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 0 });

      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(0);
    });

    it("counts a legacy numeric row whose metadata marks the cost unknown", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: 0, meta: JSON.stringify({ costStatus: "unknown" }) });

      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(1);
    });

    it("tolerates malformed metadata", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: 1.25, meta: "{broken" });
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 0 });

      expect(() => migration028.up(db)).not.toThrow();
      expect(unknownCount(db, "key-1")).toBe(0);
    });

    it("does not attribute history rows that carry no API key", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { secret: null, cost: null });
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 0 });

      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(0);
    });

    it("keeps the count when retained history is truncated", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      insertHistory(db, { cost: null });
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 4 });

      db.run(`DELETE FROM usageHistory`);
      migration028.up(db);

      expect(unknownCount(db, "key-1")).toBe(4);
    });
  });

  describe("migration runner contract", () => {
    function metaDb() {
      const db = createBetterSqliteAdapter(":memory:");
      openDbs.push(db);
      db.exec(buildCreateTableSql("_meta", TABLES._meta));
      db.exec(buildCreateTableSql("apiKeys", TABLES.apiKeys));
      return db;
    }

    it("records the version after a successful migration and applies nothing on a second run", () => {
      const db = metaDb();
      const migrations = [{
        version: 900,
        name: "probe-ok",
        up: (adapter) => {
          adapter.run(`INSERT INTO apiKeys(id, key, name, createdAt) VALUES('probe', 'probe-secret', 'Probe', '2026-01-01T00:00:00.000Z')`);
        },
      }];

      const first = applyVersionedMigrations(db, migrations);
      expect(first.applied).toBe(1);
      expect(db.get(`SELECT value FROM _meta WHERE key = 'appliedMigrations'`).value).toContain("900");

      const second = applyVersionedMigrations(db, migrations);
      expect(second.applied).toBe(0);
      expect(db.get(`SELECT COUNT(*) AS c FROM apiKeys`).c).toBe(1);
    });

    it("rolls back and does not record the version when a migration fails", () => {
      const db = metaDb();
      const migrations = [{
        version: 901,
        name: "probe-fail",
        up: (adapter) => {
          adapter.run(`INSERT INTO apiKeys(id, key, name, createdAt) VALUES('probe', 'probe-secret', 'Probe', '2026-01-01T00:00:00.000Z')`);
          throw new Error("probe failure");
        },
      }];

      expect(() => applyVersionedMigrations(db, migrations)).toThrow("probe failure");
      expect(db.get(`SELECT COUNT(*) AS c FROM apiKeys`).c).toBe(0);
      const recorded = db.get(`SELECT value FROM _meta WHERE key = 'appliedMigrations'`);
      expect(recorded === null || recorded === undefined || !String(recorded.value).includes("901")).toBe(true);
    });
  });

  describe("PostgreSQL rewrite parity", () => {
    it("omits the unknown-cost count from the rewritten historical replacement statement", () => {
      const rewritten = rewriteSqliteDml(
        `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt)
         VALUES(?, ?, ?, ?, ?)`,
      );
      expect(rewritten).toMatch(/ON CONFLICT \("apiKeyId"\) DO UPDATE SET/i);
      expect(rewritten).not.toContain("unknownCostRequests");
    });

    it("keeps the unknown-cost count in a rewritten monotonic upsert", () => {
      const rewritten = rewriteSqliteDml(
        `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(apiKeyId) DO UPDATE SET
           totalTokens = excluded.totalTokens,
           totalCost = excluded.totalCost,
           totalRequests = excluded.totalRequests,
           unknownCostRequests = CASE WHEN apiKeyUsageTotals.unknownCostRequests < excluded.unknownCostRequests THEN excluded.unknownCostRequests ELSE apiKeyUsageTotals.unknownCostRequests END,
           updatedAt = excluded.updatedAt`,
      );
      expect(rewritten).toMatch(/DO UPDATE SET/i);
      expect(rewritten).toContain("unknownCostRequests");
      // The portable monotonic form is CASE WHEN, not the two-argument MAX():
      // PG has no max(bigint, bigint), which the live PG suite proved.
      const monotonic = rewritten.match(
        /unknownCostRequests"?\s*=\s*CASE WHEN\s+(\S+)\s+<\s+(\S+)\s+THEN\s+(\S+)\s+ELSE\s+(\S+)\s+END/i
      );
      expect(monotonic).not.toBeNull();
      expect(monotonic[3]).toMatch(/^excluded\./);
      expect(monotonic[4]).not.toMatch(/^excluded\./);
      expect(rewritten).not.toMatch(/MAX\s*\(/i);
    });

    it("applies a monotonic upsert on SQLite without lowering the durable count", () => {
      const db = freshDb();
      insertKey(db, "key-1");
      setTotals(db, "key-1", { totalRequests: 1, unknownCostRequests: 5 });

      db.run(
        `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(apiKeyId) DO UPDATE SET
           totalTokens = excluded.totalTokens,
           totalCost = excluded.totalCost,
           totalRequests = excluded.totalRequests,
           unknownCostRequests = CASE WHEN apiKeyUsageTotals.unknownCostRequests < excluded.unknownCostRequests THEN excluded.unknownCostRequests ELSE apiKeyUsageTotals.unknownCostRequests END,
           updatedAt = excluded.updatedAt`,
        ["key-1", 0, 0, 1, 1, NOW],
      );
      expect(unknownCount(db, "key-1")).toBe(5);

      db.run(
        `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(apiKeyId) DO UPDATE SET
           totalTokens = excluded.totalTokens,
           totalCost = excluded.totalCost,
           totalRequests = excluded.totalRequests,
           unknownCostRequests = CASE WHEN apiKeyUsageTotals.unknownCostRequests < excluded.unknownCostRequests THEN excluded.unknownCostRequests ELSE apiKeyUsageTotals.unknownCostRequests END,
           updatedAt = excluded.updatedAt`,
        ["key-1", 0, 0, 9, 7, NOW],
      );
      expect(unknownCount(db, "key-1")).toBe(7);
    });
  });
});
