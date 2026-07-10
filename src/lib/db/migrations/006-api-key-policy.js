import { ensureAndBackfillApiKeyUsageTotals } from "./apiKeyUsageTotalsBackfill.js";

// Add per-key policy storage and initialize lifetime totals from authoritative
// history. The forward v7 repair covers databases already stamped at v6.
export default {
  version: 6,
  name: "api-key-policy",
  up(db) {
    const columns = db.all(`PRAGMA table_info(apiKeys)`);
    if (!columns.some((column) => column.name === "policy")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN policy TEXT`);
    }
    ensureAndBackfillApiKeyUsageTotals(db);
  },
};
