// Add the opt-in API-key-to-provider-account relation table. Pairs an apiKey
// id with a providerConnections id; zero rows for a key means the key keeps
// the existing unrestricted behavior (every provider account reachable).
//
// Cascading FKs preserve referential integrity when a key or connection is
// removed. Deleting the last scoped connection can leave a key with zero rows
// and therefore unrestricted, as mandated by the zero-rows invariant.
// Deletion-policy integration remains unresolved outside this DB layer.
import { TABLES, buildCreateTableSql } from "../schema.js";

const migration = {
  version: 14,
  name: "api-key-provider-connections",
  up(db) {
    db.exec(buildCreateTableSql("apiKeyProviderConnections", TABLES.apiKeyProviderConnections));
  },
};

export default migration;
