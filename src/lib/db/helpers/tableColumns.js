// Engine-aware column introspection for one table.
//
// SQLite reflects with PRAGMA, PostgreSQL with information_schema for the
// current schema. Kept in its own module so the usage attribution helpers can
// read the usage history shape without depending on the totals helpers.

export function tableColumnNames(db, table) {
  const rows = db.driver === "pg"
    ? db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", [table])
    : db.all(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}
