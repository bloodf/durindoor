// Add providerConnectionId to mcpInstances so the gateway can resolve a stored
// z.ai (or other) provider key for Streamable HTTP without ever exposing the
// secret in headers JSON. The column is nullable; non-connection-backed
// instances keep their existing static headers or OAuth tokens.
//
// TABLES.mcpInstances already declares this column, so a fresh DB picks it
// up via buildCreateTableSql in migration 002. Existing v11 DBs need an
// explicit ALTER; tolerate the duplicate-column error so a fresh DB created
// against a future schema does not crash the migration chain.
const migration = {
  version: 12,
  name: "mcp-provider-connection",
  up(db) {
    try {
      db.exec(`ALTER TABLE mcpInstances ADD COLUMN providerConnectionId TEXT`);
    } catch (err) {
      const msg = String(err);
      if (!/duplicate column|already exists|column.*exists|no such table/i.test(msg)) {
        throw err;
      }
    }
  },
};

export default migration;
