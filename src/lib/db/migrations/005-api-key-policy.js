// Add `policy` JSON column to apiKeys for per-key model allowlist, max lifetime
// tokens, and max lifetime cost. Also create apiKeyUsageTotals table for
// per-key lifetime counters. Additive only — syncSchemaFromTables also handles
// these for existing DBs, but the migration stamps the version.
export default {
  version: 5,
  name: "api-key-policy",
  up(db) {
    try {
      const cols = db.all(`PRAGMA table_info(apiKeys)`);
      if (!cols.some((c) => c.name === "policy")) {
        db.exec(`ALTER TABLE apiKeys ADD COLUMN policy TEXT`);
      }
    } catch (err) {
      if (!/duplicate column|already exists|column.*exists/i.test(String(err))) {
        throw err;
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS apiKeyUsageTotals (
        apiKeyId TEXT PRIMARY KEY,
        totalTokens INTEGER DEFAULT 0,
        totalCost REAL DEFAULT 0,
        totalRequests INTEGER DEFAULT 0,
        updatedAt TEXT NOT NULL
      )
    `);
  },
};
