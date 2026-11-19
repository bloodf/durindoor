import { afterEach, describe, expect, it } from "vitest";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import { backfillApiKeyUsageTotals } from "../../src/lib/db/helpers/apiKeyUsageTotals.js";
import { ensureAndBackfillApiKeyUsageTotals } from "../../src/lib/db/migrations/apiKeyUsageTotalsBackfill.js";

const databases = [];
const secret = "isolated-1655-key";

afterEach(() => {
  while (databases.length) databases.pop().close();
});

function fixture() {
  const db = createBetterSqliteAdapter(":memory:");
  databases.push(db);
  for (const table of ["apiKeys", "usageHistory", "apiKeyUsageTotals"]) {
    db.exec(buildCreateTableSql(table, TABLES[table]));
  }
  db.run(`INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt)
          VALUES('key-id', ?, 'fixture', 1, '[]', '2026-01-01')`, [secret]);
  return db;
}

function addHistory(db, { cost = null, meta = "{}", provider = "openai", status = "ok" } = {}) {
  db.run(`INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens,
          completionTokens, cost, status, tokens, meta)
          VALUES('2026-01-02', ?, 'model', ?, 2, 3, ?, ?, '{}', ?)`,
  [provider, secret, cost, status, meta]);
}

function count(db) {
  return Number(db.get("SELECT unknownCostRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-id'")?.unknownCostRequests ?? 0);
}

describe("#1655 historical unknown-cost rebuilds", () => {
  it.each([
    ["current helper", (db) => backfillApiKeyUsageTotals(db)],
    ["legacy helper", ensureAndBackfillApiKeyUsageTotals],
  ])("%s rebuilds an absent totals row from NULL-cost and legacy metadata history once", (_label, rebuild) => {
    const db = fixture();
    addHistory(db, { cost: null, meta: '{"costStatus":"unknown"}' });
    addHistory(db, { cost: 0, meta: '{"costStatus":"unknown"}' });
    addHistory(db, { cost: 1, meta: "{}" });

    rebuild(db);

    expect(count(db)).toBe(2);
    expect(Number(db.get("SELECT totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-id'").totalRequests)).toBe(3);
  });

  it("preserves the retained-history lower bound during legacy replacement rebuild", () => {
    const db = fixture();
    db.run(`INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests)
            VALUES('key-id', 99, 9, 99, 1)`);
    addHistory(db, { cost: null });
    addHistory(db, { cost: 0, meta: '{"costStatus":"unknown"}' });

    ensureAndBackfillApiKeyUsageTotals(db);

    expect(count(db)).toBe(2);
    expect(Number(db.get("SELECT totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'key-id'").totalRequests)).toBe(2);
  });

  it("exempts only failed MCP rows and retains NULL attribution counts", () => {
    const db = fixture();
    addHistory(db, { provider: "mcp-gateway", status: "error" });
    addHistory(db, { provider: "openai", status: "error" });
    addHistory(db, { provider: null, status: "error" });
    addHistory(db, { provider: "mcp-gateway", status: null });

    backfillApiKeyUsageTotals(db, { overwrite: true });

    expect(count(db)).toBe(3);
  });

  it("does not lower a durable count or double count on repeated rebuilds", () => {
    const db = fixture();
    db.run(`INSERT INTO apiKeyUsageTotals(apiKeyId, unknownCostRequests) VALUES('key-id', 5)`);
    addHistory(db, { cost: null });

    ensureAndBackfillApiKeyUsageTotals(db);
    ensureAndBackfillApiKeyUsageTotals(db);

    expect(count(db)).toBe(5);
  });
});
