import { afterEach, beforeEach, expect, it } from "vitest";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import migration from "../../src/lib/db/migrations/026-usage-unknown-cost.js";

let db;
beforeEach(() => {
  db = createBetterSqliteAdapter(":memory:");
  // Model an existing installation before migration 026, not the current schema.
  db.exec(`
    CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE);
    CREATE TABLE usageHistory (id INTEGER PRIMARY KEY, timestamp TEXT, apiKey TEXT, cost REAL, meta TEXT);
    CREATE TABLE apiKeyUsageTotals (
      apiKeyId TEXT PRIMARY KEY, totalTokens INTEGER NOT NULL DEFAULT 0,
      totalCost REAL NOT NULL DEFAULT 0, totalRequests INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    );
    INSERT INTO apiKeys VALUES ('existing', 'secret-existing'), ('missing', 'secret-missing'), ('known', 'secret-known');
    INSERT INTO apiKeyUsageTotals VALUES ('existing', 42, 1.25, 12, '2026-10-01T00:00:00.000Z');
  `);
});
afterEach(() => db?.close());

it("backfills NULL and legacy unknown costs once, tolerates malformed metadata, and preserves durable totals", () => {
  const history = [
    ["secret-existing", null, null],
    ["secret-existing", null, '{"costStatus":"unknown"}'],
    ["secret-existing", 0, '{"costStatus":"unknown"}'],
    ["secret-existing", 0.5, '{"costStatus":"unknown"}'],
    ["secret-existing", 0, '{"costStatus":"known"}'],
    ["secret-existing", 1.25, "{broken"],
    ["secret-existing", 0, "null"],
    ["secret-existing", 0, null],
    ["secret-missing", null, "{broken"],
    ["secret-known", 0, '{}'],
    ["deleted-secret", null, null],
    [null, null, null],
  ];
  for (const row of history) db.run("INSERT INTO usageHistory(apiKey, cost, meta) VALUES (?, ?, ?)", row);
  const before = db.all("SELECT * FROM usageHistory ORDER BY id");

  migration.up(db);
  migration.up(db);
  expect(db.all("SELECT * FROM apiKeyUsageTotals ORDER BY apiKeyId")).toEqual([
    { apiKeyId: "existing", totalTokens: 42, totalCost: 1.25, totalRequests: 12, updatedAt: "2026-10-01T00:00:00.000Z", unknownCostRequests: 4 },
    { apiKeyId: "missing", totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null, unknownCostRequests: 1 },
  ]);
  expect(db.all("SELECT * FROM usageHistory ORDER BY id")).toEqual(before);

  db.run("INSERT INTO usageHistory(apiKey, cost) VALUES (?, NULL)", ["secret-existing"]);
  migration.up(db);
  expect(db.get("SELECT unknownCostRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'existing'").unknownCostRequests).toBe(5);

  db.run("UPDATE apiKeyUsageTotals SET unknownCostRequests = 20 WHERE apiKeyId = 'existing'");
  db.exec("DELETE FROM usageHistory");
  migration.up(db);
  expect(db.all("SELECT apiKeyId, unknownCostRequests FROM apiKeyUsageTotals ORDER BY apiKeyId")).toEqual([
    { apiKeyId: "existing", unknownCostRequests: 20 },
    { apiKeyId: "missing", unknownCostRequests: 1 },
  ]);

  db.run("INSERT INTO usageHistory(apiKey, cost) VALUES (?, NULL)", ["secret-existing"]);
  migration.up(db);
  expect(db.get("SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = 'existing'")).toEqual({
    apiKeyId: "existing", totalTokens: 42, totalCost: 1.25, totalRequests: 12,
    updatedAt: "2026-10-01T00:00:00.000Z", unknownCostRequests: 20,
  });
  db.run("INSERT INTO apiKeyUsageTotals(apiKeyId) VALUES ('known')");
  expect(db.get("SELECT unknownCostRequests FROM apiKeyUsageTotals WHERE apiKeyId = 'known'").unknownCostRequests).toBe(0);
});

it.each([
  ["totals", true, false, false],
  ["history", false, true, false],
  ["totals and history", true, true, false],
  ["keys", false, false, true],
  ["keys and totals", true, false, true],
  ["keys and history", false, true, true],
  ["keys, totals and history", true, true, true],
])("repairs missing %s before backfill and remains safe on retry", (_label, missingTotals, missingHistory, missingKeys) => {
  db.run("INSERT INTO usageHistory(apiKey, cost) VALUES (?, NULL)", ["secret-existing"]);
  if (missingTotals) db.exec("DROP TABLE apiKeyUsageTotals");
  if (missingHistory) db.exec("DROP TABLE usageHistory");
  if (missingKeys) db.exec("DROP TABLE apiKeys");

  migration.up(db);
  migration.up(db);

  expect(db.all("PRAGMA table_info(apiKeyUsageTotals)").find((column) => column.name === "unknownCostRequests"))
    .toMatchObject({ notnull: 1, dflt_value: "0" });
  expect(db.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(missingHistory ? 0 : 1);
  expect(db.get("SELECT COUNT(*) AS count FROM apiKeys").count).toBe(missingKeys ? 0 : 3);
  expect(db.all("SELECT * FROM apiKeyUsageTotals")).toEqual(
    missingTotals && (missingHistory || missingKeys) ? [] : [{
      apiKeyId: "existing",
      totalTokens: missingTotals ? 0 : 42,
      totalCost: missingTotals ? 0 : 1.25,
      totalRequests: missingTotals ? 0 : 12,
      updatedAt: missingTotals ? null : "2026-10-01T00:00:00.000Z",
      unknownCostRequests: missingHistory || missingKeys ? 0 : 1,
    }]
  );
  // Repaired history accepts new requests; retries count evidence without
  // reconstructing monetary charges or replacing durable aggregates.
  if (missingKeys) {
    db.run("INSERT INTO apiKeys(id, key, createdAt) VALUES (?, ?, ?)", ["missing", "secret-missing", "2026-10-09T00:00:00.000Z"]);
  }
  db.run("INSERT INTO usageHistory(timestamp, apiKey, cost) VALUES (?, ?, NULL)", ["2026-10-09T00:00:00.000Z", "secret-missing"]);
  migration.up(db);
  expect(db.get("SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = 'missing'")).toEqual({
    apiKeyId: "missing", totalTokens: 0, totalCost: 0, totalRequests: 0,
    updatedAt: null, unknownCostRequests: 1,
  });
});

it("propagates backfill errors without stamping version 26 and retries the required column", () => {
  db.exec(`
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta VALUES ('schemaVersion', '25');
    INSERT INTO usageHistory(apiKey, cost) VALUES ('secret-existing', NULL);
    CREATE TRIGGER reject_unknown_backfill BEFORE UPDATE ON apiKeyUsageTotals
    BEGIN SELECT RAISE(ABORT, 'backfill blocked'); END;
  `);
  // Match the runner's transaction boundary: only successful up() stamps 26.
  const upgrade = () => db.transaction(() => {
    migration.up(db);
    db.run("UPDATE _meta SET value = '26' WHERE key = 'schemaVersion'");
  });

  expect(upgrade).toThrow("backfill blocked");
  expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("25");
  expect(db.all("PRAGMA table_info(apiKeyUsageTotals)").some((column) => column.name === "unknownCostRequests")).toBe(false);
  expect(db.get("SELECT totalCost FROM apiKeyUsageTotals WHERE apiKeyId = 'existing'").totalCost).toBe(1.25);

  db.exec("DROP TRIGGER reject_unknown_backfill");
  upgrade();
  upgrade();
  expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'").value).toBe("26");
  expect(db.get("SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = 'existing'")).toEqual({
    apiKeyId: "existing", totalTokens: 42, totalCost: 1.25, totalRequests: 12,
    updatedAt: "2026-10-01T00:00:00.000Z", unknownCostRequests: 1,
  });
});
