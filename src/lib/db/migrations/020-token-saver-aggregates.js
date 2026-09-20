import { tokenSaverEventColumns } from "../../../../open-sse/rtk/index.js";
import { TABLES } from "../schema.js";
import { translateColumnDef } from "../dialects/postgres/translate.js";

const migration = {
  version: 20,
  name: "token-saver-aggregates",
  up(db) {
    const names = Object.keys(tokenSaverEventColumns({}));
    // PG reflection/DDL differs; data normalization and backfill DML do not.
    const pg = db.driver === "pg";

    // A stamped database can legitimately be missing tables an earlier
    // migration would have created (see the "repairs a stamped vN database
    // whose tables are absent" cases). Touching one unconditionally aborts the
    // whole upgrade, so every statement below is gated on the table existing.
    const hasTable = (table) => (pg
      ? db.all(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?",
        [table]
      )
      : db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
    ).length > 0;

    if (hasTable("tokenSaverEvents")) {
      const existing = new Set((pg
        ? db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", ["tokenSaverEvents"])
        : db.all("PRAGMA table_info(tokenSaverEvents)")).map((c) => c.name));
      for (const name of names) {
        if (existing.has(name)) continue;
        const def = TABLES.tokenSaverEvents.columns[name];
        db.exec(`ALTER TABLE "tokenSaverEvents" ADD COLUMN "${name}" ${pg ? translateColumnDef(name, def) : def}`);
      }
      // Keyset-paginated backfill: the raw `data` JSON stays the source of
      // truth and is normalized through the same helper the write path uses.
      //
      // The write shape differs by engine for a measured reason. On SQLite an
      // UPDATE is an in-process call, so row-at-a-time costs microseconds. On
      // PostgreSQL every statement is a round trip through the synchronous
      // worker bridge, and 592k single-row updates took a real install past
      // ten minutes with no HTTP listener — migrations run before the server
      // accepts requests, so that is an outage, not a slow start. Batching
      // collapses it to one statement per page.
      //
      // SQLite keeps the simple path deliberately: `UPDATE ... FROM (VALUES
      // ...)` with column aliases is not dependable across the better-sqlite3
      // / node:sqlite / sql.js adapters this project falls back through.
      const columnCast = (name) => {
        const def = String(TABLES.tokenSaverEvents.columns[name] || "");
        if (/^REAL\b/i.test(def)) return "DOUBLE PRECISION";
        if (/^INTEGER\b/i.test(def)) return "BIGINT";
        return "TEXT";
      };
      const project = (row) => {
        let event;
        try { event = JSON.parse(row.data); } catch { event = {}; }
        return tokenSaverEventColumns(event);
      };
      const writePage = (rows) => {
        if (!pg) {
          for (const row of rows) {
            db.run(
              `UPDATE "tokenSaverEvents" SET ${names.map((name) => `"${name}" = ?`).join(", ")} WHERE id = ?`,
              [...Object.values(project(row)), row.id]
            );
          }
          return;
        }
        // Casts are explicit: a bare parameter inside VALUES has no inferable
        // type on PostgreSQL.
        const tuple = `(CAST(? AS BIGINT), ${names.map((name) => `CAST(? AS ${columnCast(name)})`).join(", ")})`;
        const params = [];
        for (const row of rows) {
          const values = project(row);
          params.push(row.id, ...names.map((name) => values[name]));
        }
        db.run(
          `UPDATE "tokenSaverEvents" AS t SET ${names.map((name) => `"${name}" = v."${name}"`).join(", ")} ` +
          `FROM (VALUES ${rows.map(() => tuple).join(", ")}) AS v(id, ${names.map((name) => `"${name}"`).join(", ")}) ` +
          "WHERE t.id = v.id",
          params
        );
      };
      let lastId = 0;
      for (;;) {
        const rows = db.all('SELECT id, data FROM "tokenSaverEvents" WHERE id > ? ORDER BY id LIMIT 500', [lastId]);
        if (!rows.length) break;
        writePage(rows);
        lastId = rows[rows.length - 1].id;
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_tse_date_state ON "tokenSaverEvents"("dateKey", "hrState")');
    }

    if (hasTable("usageHistory")) {
      // Covering index for the usage-stats overlay: one index-only scan instead
      // of four heap-reading GROUP BY passes.
      db.exec('CREATE INDEX IF NOT EXISTS idx_uh_ts_dims ON "usageHistory"(timestamp, provider, model, "connectionId", "apiKey", endpoint)');
    }
  },
};

export default migration;
