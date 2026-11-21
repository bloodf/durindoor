import { tableColumnNames } from "../helpers/apiKeyUsageTotals.js";

const migration = {
  version: 31,
  name: "usage-session-attribution",
  up(db) {
    const columns = tableColumnNames(db, "usageHistory");
    if (!columns.size) return;
    for (const name of ["usageSessionId", "usageProjectId"]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE "usageHistory" ADD COLUMN "${name}" TEXT`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_uh_key_session ON "usageHistory"("apiKeyId", "usageSessionId")');
    db.exec('CREATE INDEX IF NOT EXISTS idx_uh_key_project ON "usageHistory"("apiKeyId", "usageProjectId")');
  },
};

export default migration;
