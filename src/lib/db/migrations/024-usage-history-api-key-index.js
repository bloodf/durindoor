// Per-key windowed limits (src/lib/apiKeyLimits.js) sum one key's usage for
// the current day and month. Index that lookup. SQLite also gets it from the
// additive schema sync, but PostgreSQL skips that sync, so the migration is
// the only path there. `IF NOT EXISTS` keeps it idempotent on both engines.
const migration = {
  version: 24,
  name: "usage-history-api-key-index",
  up(db) {
    const pg = db.driver === "pg";
    const hasHistory = (pg ?
    db.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?", ["usageHistory"]) :
    db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["usageHistory"])).length > 0;
    if (!hasHistory) return;
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_apikey_ts ON "usageHistory"("apiKey", "timestamp")`);
  },
};
export default migration;
