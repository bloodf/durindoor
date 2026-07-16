// Add the tokenSaverEvents table for aggregate Token Saver telemetry
// (port of decolua/9router #2562). Idempotent (IF NOT EXISTS) so it is safe on
// databases that already created the table via the declarative schema sync.
import { TABLES, buildCreateTableSql } from "../schema.js";

const NAME = "tokenSaverEvents";

const migration = {
  version: 10,
  name: "token-saver-events",
  up(db) {
    const def = TABLES[NAME];
    db.exec(buildCreateTableSql(NAME, def));
    for (const idx of def.indexes || []) {
      try { db.exec(idx); } catch { /* retried by syncSchemaFromTables */ }
    }
  },
};

export default migration;
