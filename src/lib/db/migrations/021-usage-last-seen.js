import { usageTokenColumns } from "./usage-token-columns.js";

const migration = {
  version: 21,
  name: "usage-last-seen",
  up(db) {
    // Reflection differs by engine; all data queries below are portable SQL.
    const pg = db.driver === "pg";
    const hasHistory = (pg
      ? db.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?", ["usageHistory"])
      : db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["usageHistory"])).length > 0;
    db.exec(`CREATE TABLE IF NOT EXISTS "usageLastSeen" (
      "dateKey" TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
      "connectionId" TEXT NOT NULL, "apiKey" TEXT NOT NULL, endpoint TEXT NOT NULL,
      "lastUsed" TEXT NOT NULL,
      PRIMARY KEY ("dateKey", provider, model, "connectionId", "apiKey", endpoint)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_uls_date ON "usageLastSeen"("dateKey")');
    if (!hasHistory) return;
    const existing = new Set((pg
      ? db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", ["usageHistory"])
      : db.all("PRAGMA table_info(usageHistory)")).map((c) => c.name));
    for (const name of Object.keys(usageTokenColumns())) {
      if (!existing.has(name)) db.exec(`ALTER TABLE "usageHistory" ADD COLUMN "${name}" ${pg ? "DOUBLE PRECISION" : "REAL"} NOT NULL DEFAULT 0`);
    }
    // Row-at-a-time is microseconds on SQLite but a round trip per row through
    // the synchronous worker bridge on PostgreSQL, which is an outage at this
    // table's size (764k rows on a real install, and migrations run before the
    // server accepts requests). Batch the PG writes into one statement per
    // page; SQLite keeps the simple path because `UPDATE ... FROM (VALUES ...)`
    // with column aliases is not dependable across its adapter fallbacks.
    const tokenNames = Object.keys(usageTokenColumns());
    const writePage = (rows) => {
      const project = (row) => {
        let tokens;
        try { tokens = JSON.parse(row.tokens); } catch { tokens = {}; }
        return usageTokenColumns(tokens);
      };
      if (!pg) {
        for (const row of rows) {
          db.run(
            "UPDATE usageHistory SET cachedTokens = ?, reasoningTokens = ?, cacheCreationTokens = ? WHERE id = ?",
            [...Object.values(project(row)), row.id]
          );
        }
        return;
      }
      // Explicit casts: a bare parameter inside VALUES has no inferable type.
      const tuple = `(CAST(? AS BIGINT), ${tokenNames.map(() => "CAST(? AS DOUBLE PRECISION)").join(", ")})`;
      const params = [];
      for (const row of rows) {
        const values = project(row);
        params.push(row.id, ...tokenNames.map((name) => values[name]));
      }
      db.run(
        `UPDATE "usageHistory" AS t SET ${tokenNames.map((name) => `"${name}" = v."${name}"`).join(", ")} ` +
        `FROM (VALUES ${rows.map(() => tuple).join(", ")}) AS v(id, ${tokenNames.map((name) => `"${name}"`).join(", ")}) ` +
        "WHERE t.id = v.id",
        params
      );
    };
    let lastId = 0;
    for (;;) {
      const rows = db.all("SELECT id, tokens FROM usageHistory WHERE id > ? ORDER BY id LIMIT 500", [lastId]);
      if (!rows.length) break;
      writePage(rows);
      lastId = rows[rows.length - 1].id;
    }
    backfillUsageLastSeen(db);
  },
};
export default migration;

export function backfillUsageLastSeen(db) {
    db.run(`INSERT INTO usageLastSeen(dateKey, provider, model, connectionId, apiKey, endpoint, lastUsed)
      SELECT SUBSTR(timestamp, 1, 10), COALESCE(provider, ''), COALESCE(model, ''),
             COALESCE(connectionId, ''), COALESCE(apiKey, ''), COALESCE(endpoint, ''), MAX(timestamp)
        FROM usageHistory
       GROUP BY SUBSTR(timestamp, 1, 10), COALESCE(provider, ''), COALESCE(model, ''),
                COALESCE(connectionId, ''), COALESCE(apiKey, ''), COALESCE(endpoint, '')
      ON CONFLICT (dateKey, provider, model, connectionId, apiKey, endpoint) DO UPDATE SET
        lastUsed = CASE WHEN excluded.lastUsed > usageLastSeen.lastUsed THEN excluded.lastUsed ELSE usageLastSeen.lastUsed END`);
}
