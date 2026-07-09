// Adds an optional expiry timestamp to API keys so expired keys can be
// identified without deleting them. The column is additive and idempotent.
export default {
  version: 6,
  name: "api-key-expiry",
  up(db) {
    // better-sqlite3 uses db.prepare(sql).all(); some adapters expose a db.all() wrapper.
    const rows = typeof db.all === "function"
      ? db.all(`PRAGMA table_info(apiKeys)`)
      : db.prepare(`PRAGMA table_info(apiKeys)`).all();
    const columns = rows.map((row) => row.name);
    if (!columns.includes("expiresAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
  },
};
