import { TOKEN_SAVER_DAILY_TABLES, backfillTokenSaverDaily } from "./token-saver-daily-schema.js";

export default {
  version: 22,
  name: "token-saver-daily",
  up(db) {
    // Only schema reflection / floating-point DDL differ between engines.
    const pg = db.driver === "pg";
    for (const [table, spec] of Object.entries(TOKEN_SAVER_DAILY_TABLES)) {
      const columns = Object.entries(spec.columns).map(([name, def]) => `"${name}" ${pg ? def.replace(/\bREAL\b/g, "DOUBLE PRECISION") : def}`);
      db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${[...columns, spec.primaryKey.replace(/\b(dateKey|localDateKey|hrSkipReason)\b/g, '"$1"')].join(", ")})`);
    }
    const exists = (pg
      ? db.all("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?", ["tokenSaverEvents"])
      : db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", ["tokenSaverEvents"])).length > 0;
    if (exists) backfillTokenSaverDaily(db);
  },
};
