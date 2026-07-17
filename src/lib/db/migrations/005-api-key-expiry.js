// Adds an optional expiry timestamp to API keys so expired keys can be
// identified without deleting or rotating their stored secret. Version 5 is
// intentionally after the already-published v4 daily-limit migration.
export default {
  version: 5,
  name: "api-key-expiry",
  up(db) {
    const rows = typeof db.all === "function"
      ? db.all(`PRAGMA table_info(apiKeys)`)
      : db.prepare(`PRAGMA table_info(apiKeys)`).all();
    const columns = rows.map((row) => row.name);
    if (!columns.includes("expiresAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
  },
};
