// SQLite → PostgreSQL mirror.
//
// Streams every row from the source SQLite tables into the target PG
// tables in 500-row chunks, inside per-table transactions, then asserts
// COUNT(*) matches. Identifiers are quoted so camelCase columns survive
// PG's lowercase fold. Each table is TRUNCATEd first so a retry cannot
// keep leftover rows. Serial sequences are advanced after explicit id
// inserts. `_meta` is copied except `schemaVersion` (the PG migration
// runner owns that key).

import { TABLES } from "../../schema.js";
import { quoteIdent } from "./dmlRewrite.js";
import { isNumber } from "../../../../shared/utils/typeChecks.js";

const DEFAULT_CHUNK = 500;
const SKIP_TABLES = new Set(["requestDetails"]);
const SERIAL_TABLES = new Map([
  ["usageHistory", "id"],
  ["tokenSaverEvents", "id"],
  ["pgCutoverLog", "id"],
]);

function tableColumns(tableName) {
  const def = TABLES[tableName];
  if (!def || !def.columns) return null;
  return Object.keys(def.columns);
}

function quotedList(cols) {
  return cols.map((c) => quoteIdent(c)).join(", ");
}

async function countRows(adapter, tableName) {
  const row = await Promise.resolve(
    adapter.get(`SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`)
  );
  return row ? Number(row.c) || 0 : 0;
}

async function resetSerial(pg, tableName, col) {
  const sql =
    `SELECT setval(pg_get_serial_sequence('${tableName.replace(/'/g, "''")}', '${col}'), ` +
    `COALESCE((SELECT MAX(${quoteIdent(col)}) FROM ${quoteIdent(tableName)}), 1), ` +
    `MAX(${quoteIdent(col)}) IS NOT NULL)`;
  try {
    await Promise.resolve(pg.get(sql));
  } catch {
    // Table has no sequence (TEXT pk) — ignore.
  }
}

/**
 * Mirror every SQLite table into the corresponding PG table.
 */
export async function runMirror(sqlite, pg, options = {}) {
  const chunkSize = isNumber(options.chunkSize) ? options.chunkSize : DEFAULT_CHUNK;
  const includeRequestDetails = Boolean(options.includeRequestDetails);
  const skip = new Set(SKIP_TABLES);
  if (includeRequestDetails) skip.delete("requestDetails");
  const perTable = {};
  let tablesMigrated = 0;
  let rowsMigrated = 0;

  const names = Object.keys(TABLES);
  for (const tableName of names) {
    if (skip.has(tableName)) continue;
    const cols = tableColumns(tableName);
    if (!cols || !cols.length) continue;

    const sourceCount = await countRows(sqlite, tableName);
    if (tableName !== "_meta") {
      try {
        await Promise.resolve(pg.exec(`TRUNCATE TABLE ${quoteIdent(tableName)}`));
      } catch (err) {
        return {
          ok: false,
          tablesMigrated,
          rowsMigrated,
          error: `${tableName}: TRUNCATE failed: ${err.message}`,
          perTable,
        };
      }
    }

    if (sourceCount === 0) {
      if (tableName === "_meta") {
        // Keep PG schemaVersion; nothing else to copy.
      }
      perTable[tableName] = { rows: 0, ok: true };
      tablesMigrated += 1;
      continue;
    }

    const colList = quotedList(cols);
    const placeholders = cols.map(() => "?").join(", ");
    const insertSql = tableName === "_meta"
      ? `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
      : `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders})`;
    let inserted = 0;
    let offset = 0;
    let error = null;

    while (offset < sourceCount) {
      const sourceRows = await Promise.resolve(
        sqlite.all(
          `SELECT ${colList} FROM ${quoteIdent(tableName)} LIMIT ? OFFSET ?`,
          [chunkSize, offset]
        )
      );
      if (!sourceRows || !sourceRows.length) break;
      try {
        await Promise.resolve(pg.transaction(() => {
          for (const row of sourceRows) {
            if (tableName === "_meta" && row.key === "schemaVersion") continue;
            const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
            if (tableName === "_meta") {
              pg.run(
                `INSERT INTO ${quoteIdent("_meta")} (${colList}) VALUES (${placeholders}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                values
              );
            } else {
              pg.run(insertSql, values);
            }
            inserted += 1;
          }
        }));
      } catch (err) {
        error = err.message;
        break;
      }
      offset += sourceRows.length;
    }

    if (error) {
      perTable[tableName] = { rows: inserted, ok: false, error };
      return { ok: false, tablesMigrated, rowsMigrated, error: `${tableName}: ${error}`, perTable };
    }

    const targetCount = await countRows(pg, tableName);
    // `_meta` keeps PG schemaVersion and copies every other key. Compare
    // non-schemaVersion keys only.
    if (tableName === "_meta") {
      const srcKeys = await Promise.resolve(
        sqlite.all(`SELECT key FROM ${quoteIdent("_meta")} WHERE key <> ?`, ["schemaVersion"])
      );
      const dstKeys = await Promise.resolve(
        pg.all(`SELECT key FROM ${quoteIdent("_meta")} WHERE key <> ?`, ["schemaVersion"])
      );
      const srcSet = new Set((srcKeys || []).map((r) => r.key));
      const dstSet = new Set((dstKeys || []).map((r) => r.key));
      for (const k of srcSet) {
        if (!dstSet.has(k)) {
          const msg = `_meta: missing key ${k} after mirror`;
          perTable[tableName] = { rows: inserted, ok: false, error: msg };
          return { ok: false, tablesMigrated, rowsMigrated, error: msg, perTable };
        }
      }
    } else if (targetCount !== sourceCount) {
      const msg = `${tableName}: COUNT mismatch source=${sourceCount} target=${targetCount}`;
      perTable[tableName] = { rows: inserted, ok: false, error: msg };
      return { ok: false, tablesMigrated, rowsMigrated, error: msg, perTable };
    }

    const serialCol = SERIAL_TABLES.get(tableName);
    if (serialCol) await resetSerial(pg, tableName, serialCol);

    perTable[tableName] = { rows: tableName === "_meta" ? inserted : targetCount, ok: true };
    rowsMigrated += tableName === "_meta" ? inserted : targetCount;
    tablesMigrated += 1;
  }

  return { ok: true, tablesMigrated, rowsMigrated, perTable };
}
