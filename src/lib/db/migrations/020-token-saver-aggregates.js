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
      let lastId = 0;
      for (;;) {
        const rows = db.all('SELECT id, data FROM "tokenSaverEvents" WHERE id > ? ORDER BY id LIMIT 500', [lastId]);
        if (!rows.length) break;
        for (const row of rows) {
          let event;
          try { event = JSON.parse(row.data); } catch { event = {}; }
          const values = tokenSaverEventColumns(event);
          db.run(`UPDATE "tokenSaverEvents" SET ${names.map((name) => `"${name}" = ?`).join(", ")} WHERE id = ?`, [...Object.values(values), row.id]);
        }
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
