// Initial schema bootstrap. For fresh DB this creates all tables/indexes.
// For existing DB at version 0 (legacy unstamped), it's idempotent (IF NOT EXISTS).
import { TABLES, buildCreateTableSql } from "../schema.js";

export default {
  version: 1,
  name: "initial",
  up(db) {
    for (const [name, def] of Object.entries(TABLES)) {
      db.exec(buildCreateTableSql(name, def));
      // A legacy unstamped database can already contain an older table shape.
      // Indexes for newly declared columns must wait for the additive schema
      // sync, which adds missing columns and then retries every index.
      for (const idx of def.indexes || []) {
        try { db.exec(idx); } catch { /* retried by syncSchemaFromTables */ }
      }
    }
  },
};
