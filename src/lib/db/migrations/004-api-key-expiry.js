// Adds an optional expiry timestamp to API keys so expired keys can be
// identified without deleting them. The column is additive and idempotent.
export default {
  version: 4,
  name: "api-key-expiry",
  up(db) {
    const columns = db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name);
    if (!columns.includes("expiresAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
  },
};
