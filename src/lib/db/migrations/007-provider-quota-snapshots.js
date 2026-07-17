import { QUOTA_V7_TABLES, buildQuotaV7TableSql } from "./quota-v7-schema.js";

// Durable provider observations and fetch outcomes. Local cumulative usage and
// in-flight reservations intentionally remain in their existing/later domains.
const TABLE_NAMES = ["providerQuotaSnapshots", "quotaFetchStates"];

const migration = {
  version: 7,
  name: "provider-quota-snapshots",
  up(db) {
    for (const name of TABLE_NAMES) {
      const definition = QUOTA_V7_TABLES[name];
      db.exec(buildQuotaV7TableSql(name));
      for (const index of definition.indexes || []) db.exec(index);
    }
  },
};

export default migration;
