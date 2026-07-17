// Published schema v8 is immutable. Operational reservations are deliberately
// separate from providerQuotaSnapshots: provider observations are facts from
// the upstream and must never be decremented by local routing decisions.
function freezeTable(definition) {
  Object.freeze(definition.columns);
  Object.freeze(definition.indexes);
  return Object.freeze(definition);
}

export const QUOTA_V8_TABLES = Object.freeze({
  quotaReservations: freezeTable({
    columns: {
      id: "TEXT PRIMARY KEY",
      connectionId: "TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE",
      provider: "TEXT NOT NULL",
      routeKeyHash: "TEXT NOT NULL",
      state: "TEXT NOT NULL CHECK (state IN ('active','committed','released','abandoned'))",
      ownerEpoch: "TEXT NOT NULL",
      acquiredAt: "TEXT NOT NULL",
      dispatchedAt: "TEXT",
      terminalAt: "TEXT",
      leaseExpiresAt: "TEXT NOT NULL",
      lastHeartbeatAt: "TEXT NOT NULL",
      terminalReason: "TEXT CHECK (terminalReason IS NULL OR terminalReason IN ('success','capacity_race','pre_dispatch','upstream_error','transport_error','abort','timeout','stream_error','stream_cancel','malformed_terminal','fallback','lease_expired','snapshot_superseded','shutdown'))",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_qr_active_expiry ON quotaReservations(state, leaseExpiresAt)",
      "CREATE INDEX IF NOT EXISTS idx_qr_connection_state ON quotaReservations(connectionId, state)",
      "CREATE INDEX IF NOT EXISTS idx_qr_route_history ON quotaReservations(routeKeyHash, acquiredAt)",
      "CREATE INDEX IF NOT EXISTS idx_qr_terminal_retention ON quotaReservations(state, terminalAt)",
    ],
  }),
  quotaReservationItems: freezeTable({
    columns: {
      reservationId: "TEXT NOT NULL REFERENCES quotaReservations(id) ON DELETE CASCADE",
      accountKey: "TEXT NOT NULL",
      resourceKey: "TEXT NOT NULL",
      dimensionKey: "TEXT NOT NULL",
      unit: "TEXT",
      reservedAmount: "REAL NOT NULL CHECK (reservedAmount > 0 AND reservedAmount <= 9007199254740991)",
      committedAmount: "REAL CHECK (committedAmount IS NULL OR (committedAmount >= 0 AND committedAmount <= 9007199254740991))",
      basisObservedAt: "TEXT NOT NULL",
      basisResetAt: "TEXT",
    },
    primaryKey: "PRIMARY KEY (reservationId, accountKey, resourceKey, dimensionKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_qri_identity ON quotaReservationItems(accountKey, resourceKey, dimensionKey, basisObservedAt)",
      "CREATE INDEX IF NOT EXISTS idx_qri_reservation ON quotaReservationItems(reservationId)",
    ],
  }),
});

export function buildQuotaV8TableSql(name) {
  const definition = QUOTA_V8_TABLES[name];
  if (!definition) throw new Error(`Unknown quota v8 table: ${name}`);
  const columns = Object.entries(definition.columns).map(([column, shape]) => `${column} ${shape}`);
  if (definition.primaryKey) columns.push(definition.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${columns.join(", ")})`;
}
