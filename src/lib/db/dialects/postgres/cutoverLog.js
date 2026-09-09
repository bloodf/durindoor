// Append a row to the `pgCutoverLog` table on the PG cluster.
//
// The `pgCutoverLog` table is created by the parallel PG migration set
// (migration #018). On PG, this function inserts a single row; on any
// failure it logs a warning and returns false (the cutover is
// considered successful even if the log row could not be written).

import { isObject } from "../../../../shared/utils/typeChecks.js";

export async function appendCutoverLog(pg, entry) {
  if (!pg || !isObject(entry)) return false;
  const type = String(entry.type || "test");
  const ok = entry.ok === false ? 0 : 1;
  try {
    await pg.run(
      `INSERT INTO pgCutoverLog(type, ok, durationMs, schemaVersion, tablesMigrated, rowsMigrated, errorCode, errorMessage)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        type,
        ok,
        entry.durationMs == null ? null : entry.durationMs,
        entry.schemaVersion == null ? null : entry.schemaVersion,
        entry.tablesMigrated == null ? null : entry.tablesMigrated,
        entry.rowsMigrated == null ? null : entry.rowsMigrated,
        entry.errorCode || null,
        entry.errorMessage || null,
      ]
    );
    return true;
  } catch (err) {
    console.warn(`[DB][cutoverLog] append failed: ${err.message}`);
    return false;
  }
}

export async function listCutoverLog(pg, { limit = 50 } = {}) {
  if (!pg) return [];
  const rows = await pg.all(
    `SELECT id, at, type, ok, durationMs, schemaVersion, tablesMigrated, rowsMigrated, errorCode, errorMessage
     FROM pgCutoverLog ORDER BY at DESC LIMIT ?`,
    [limit]
  );
  return rows || [];
}
