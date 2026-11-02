// Adds the explicit admin scope to API keys. Only admin-scoped keys may change
// management state; every existing key starts without it. PostgreSQL skips the
// additive SQLite schema sync, so the migration is the only path there.
const migration = {
  version: 27,
  name: "api-key-admin-scope",
  up(db) {
    const pg = db.driver === "pg";
    const columns = (pg
      ? db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", ["apiKeys"])
      : db.all("PRAGMA table_info(apiKeys)")).map((column) => column.name);
    if (!columns.length || columns.includes("isAdmin")) return;
    db.exec(`ALTER TABLE "apiKeys" ADD COLUMN "isAdmin" INTEGER NOT NULL DEFAULT 0`);
  },
};
export default migration;
