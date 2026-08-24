// Published schema v7 is immutable. New quota columns or constraints belong in
// a later migration; changing these definitions would rewrite historical v7.
function freezeTable(definition) {
  Object.freeze(definition.columns);
  Object.freeze(definition.indexes);
  return Object.freeze(definition);
}

export const QUOTA_V7_TABLES = Object.freeze({
  providerQuotaSnapshots: freezeTable({
    columns: {
      connectionId: "TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE",
      accountKey: "TEXT NOT NULL",
      resourceKey: "TEXT NOT NULL",
      dimensionKey: "TEXT NOT NULL",
      state: "TEXT NOT NULL CHECK (state IN ('available','low','exhausted','cooldown','unknown','error'))",
      limitKind: "TEXT NOT NULL CHECK (limitKind IN ('bounded','unlimited','unknown'))",
      limitValue: "REAL CHECK (limitValue IS NULL OR (limitValue >= 0 AND limitValue <= 9007199254740991))",
      usedValue: "REAL CHECK (usedValue IS NULL OR (usedValue >= 0 AND usedValue <= 9007199254740991))",
      remainingValue: "REAL CHECK (remainingValue IS NULL OR (remainingValue >= 0 AND remainingValue <= 9007199254740991))",
      remainingRatio: "REAL CHECK (remainingRatio IS NULL OR remainingRatio BETWEEN 0 AND 1)",
      unit: "TEXT",
      resetAt: "TEXT",
      cooldownUntil: "TEXT",
      observedAt: "TEXT NOT NULL",
      staleAt: "TEXT NOT NULL",
      sourceType: "TEXT NOT NULL CHECK (sourceType IN ('provider_api','response_headers','import'))",
      sourceId: "TEXT NOT NULL",
      reasonCode: "TEXT CHECK (reasonCode IS NULL OR reasonCode IN ('missing','malformed','unauthenticated','forbidden','rate_limited','timeout','network_error','provider_error'))",
      metadataJson: "TEXT NOT NULL DEFAULT '{}'",
    },
    primaryKey: "PRIMARY KEY (connectionId, accountKey, resourceKey, dimensionKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pqs_stale ON providerQuotaSnapshots(staleAt)",
      "CREATE INDEX IF NOT EXISTS idx_pqs_observed ON providerQuotaSnapshots(observedAt)",
      "CREATE INDEX IF NOT EXISTS idx_pqs_source ON providerQuotaSnapshots(connectionId, sourceId)",
    ],
  }),
  quotaFetchStates: freezeTable({
    columns: {
      connectionId: "TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE",
      sourceId: "TEXT NOT NULL",
      outcome: "TEXT NOT NULL CHECK (outcome IN ('success','missing','malformed','unauthenticated','forbidden','rate_limited','timeout','network_error','provider_error'))",
      lastObservedAt: "TEXT",
      attemptedAt: "TEXT NOT NULL",
      retryAt: "TEXT",
      lastSuccessAt: "TEXT",
      reasonCode: "TEXT CHECK (reasonCode IS NULL OR reasonCode IN ('missing','malformed','unauthenticated','forbidden','rate_limited','timeout','network_error','provider_error'))",
    },
    primaryKey: "PRIMARY KEY (connectionId, sourceId)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_qfs_retry ON quotaFetchStates(outcome, retryAt)"],
  }),
});

export function buildQuotaV7TableSql(name) {
  const definition = QUOTA_V7_TABLES[name];
  if (!definition) throw new Error(`Unknown quota v7 table: ${name}`);
  const columns = Object.entries(definition.columns).map(([column, layout]) => `${column} ${layout}`);
  if (definition.primaryKey) columns.push(definition.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${columns.join(", ")})`;
}
