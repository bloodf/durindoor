function tableColumns(db, tableName) {
  const table = db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [tableName]);
  return table ? db.all(`PRAGMA table_info(${tableName})`) : [];
}

/**
 * Verify the published v5 expiry column independently of migration selection.
 * This catches incompatible partial/stamped schemas without ever editing the
 * immutable v5 migration file.
 */
export function verifyApiKeyExpiryColumnShape(db) {
  const column = tableColumns(db, "apiKeys").find((row) => row.name === "expiresAt");
  if (!column) return;

  const compatible = String(column.type || "").toUpperCase() === "TEXT"
    && Number(column.notnull || 0) === 0
    && Number(column.pk || 0) === 0
    && column.dflt_value == null;
  if (!compatible) {
    throw new Error("Published schema mismatch: apiKeys.expiresAt must be nullable TEXT without a default");
  }
}

export function verifyPublishedSchemaShapes(db) {
  verifyApiKeyExpiryColumnShape(db);
}
