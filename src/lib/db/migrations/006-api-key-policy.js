import { backfillApiKeyUsageTotals, ensureApiKeyUsageTotalsTable } from "../helpers/apiKeyUsageTotals.js";

// Add `policy` JSON to apiKeys and the durable lifetime-counter table used by
// policy enforcement. The table must be created in this migration, before the
// backfill, because an upgrade from schema v5 has never seen the current
// declarative schema. Stored API-key secrets are only joined for attribution;
// they are never rewritten.
export default {
  version: 6,
  name: "api-key-policy",
  up(db) {
    const cols = db.all(`PRAGMA table_info(apiKeys)`);
    if (!cols.some((c) => c.name === "policy")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN policy TEXT`);
    }

    ensureApiKeyUsageTotalsTable(db);

    // Backfill lifetime totals from historical usage. Pre-existing databases
    // would otherwise enforce new limits from zero instead of real usage.

    backfillApiKeyUsageTotals(db);
  },
};
