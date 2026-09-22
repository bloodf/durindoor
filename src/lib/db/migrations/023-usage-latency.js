// Per-request timing on the usage row, so the dashboard can report duration,
// time to first token and throughput per model/account/key without joining
// requestDetails. Additive and backfill-free: existing rows keep 0, which the
// aggregation reads as "not timed" and excludes from every rate.
//
// Also the per-rate cost split, priced per request at insert so long-context
// tiers land in the right category. Existing rows keep NULL, which the
// aggregation reads as "no split" and prices separately or not at all.
const migration = {
  version: 23,
  name: "usage-latency",
  up(db) {
    // Reflection differs by engine; the DDL below is portable.
    const pg = db.driver === "pg";
    const hasHistory = (pg ?
    db.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?", ["usageHistory"]) :
    db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["usageHistory"])).length > 0;
    if (!hasHistory) return;

    const existing = new Set((pg ?
    db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", ["usageHistory"]) :
    db.all("PRAGMA table_info(usageHistory)")).map((c) => c.name));

    for (const name of ["latencyMs", "ttftMs"]) {
      if (!existing.has(name)) db.exec(`ALTER TABLE "usageHistory" ADD COLUMN "${name}" ${pg ? "BIGINT" : "INTEGER"} NOT NULL DEFAULT 0`);
    }
    for (const name of ["inputCost", "cachedCost", "cacheCreationCost", "outputCost", "reasoningCost"]) {
      if (!existing.has(name)) db.exec(`ALTER TABLE "usageHistory" ADD COLUMN "${name}" ${pg ? "DOUBLE PRECISION" : "REAL"}`);
    }
  },
};
export default migration;
