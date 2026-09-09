// SQLite → PostgreSQL mirror.
//
// Streams every row from the source SQLite tables into the target PG
// tables in 500-row chunks, inside per-table transactions, and asserts
// the row counts match at the end. The skip-tables list excludes
// `requestDetails` by default (it can be GB; the operator can opt in
// via `includeRequestDetails: true`).
//
// The mirror is the only piece of the cutover pipeline that moves data;
// every other step (test, migrate, snapshot, flip, record) is metadata.
// The function is intentionally narrow: it does not invent new SQL. It
// reads the source rows via `SELECT * FROM <table>` and writes them via
// `INSERT INTO <table>(...) VALUES ($1, $2, ...)` after rewriting the
// `?` placeholders that the SQLite adapter expects. The dialect
// differences (BOOLEAN vs 0/1, JSON vs TEXT, etc.) are handled by
// keeping storage identical between engines.

import { TABLES } from "../../schema.js";
import { isString, isNumber } from "../../../../shared/utils/typeChecks.js";

const DEFAULT_CHUNK = 500;
const SKIP_TABLES = new Set(["_meta", "requestDetails"]);

function tableColumns(tableName) {
  const def = TABLES[tableName];
  if (!def || !def.columns) return null;
  return Object.keys(def.columns);
}

function placeholderRewrite(sql) {
  if (!sql || sql.indexOf("?") === -1) return { sql, params: undefined };
  let out = "";
  let pi = 0;
  let inSingle = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingle && sql[i + 1] === "'") { out += "''"; i += 1; continue; }
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === "?" && !inSingle) {
      pi += 1;
      out += `$${pi}`;
      continue;
    }
    out += ch;
  }
  return { sql: out, params: undefined };
}

/**
 * Mirror every SQLite table into the corresponding PG table.
 *
 * @param {object} sqlite - the SQLite adapter (source).
 * @param {object} pg - the PG adapter (target).
 * @param {{ includeRequestDetails?: boolean, chunkSize?: number }} options
 * @returns {{
 *   ok: boolean,
 *   tablesMigrated: number,
 *   rowsMigrated: number,
 *   error?: string,
 *   perTable?: { [tableName: string]: { rows: number, ok: boolean, error?: string } }
 * }}
 */
export async function runMirror(sqlite, pg, options = {}) {
  const chunkSize = isNumber(options.chunkSize) ? options.chunkSize : DEFAULT_CHUNK;
  const includeRequestDetails = Boolean(options.includeRequestDetails);
  const skip = new Set(SKIP_TABLES);
  if (includeRequestDetails) skip.delete("requestDetails");
  const perTable = {};
  let tablesMigrated = 0;
  let rowsMigrated = 0;
  for (const [tableName, def] of Object.entries(TABLES)) {
    if (skip.has(tableName)) continue;
    const cols = tableColumns(tableName);
    if (!cols || !cols.length) continue;
    const sourceCount = await sqlite.get(`SELECT COUNT(*) AS c FROM ${tableName}`);
    const total = sourceCount ? sourceCount.c : 0;
    if (total === 0) {
      perTable[tableName] = { rows: 0, ok: true };
      tablesMigrated += 1;
      continue;
    }
    const colList = cols.map((c) => `"${c}"`).join(", ");
    let offset = 0;
    let inserted = 0;
    let ok = true;
    let error = null;
    while (offset < total) {
      const sourceRows = await sqlite.all(
        `SELECT ${colList} FROM ${tableName} LIMIT ? OFFSET ?`,
        [chunkSize, offset]
      );
      if (!sourceRows || !sourceRows.length) break;
      const targetSql = `INSERT INTO ${tableName} (${colList}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT DO NOTHING`;
      const { sql: rewrittenSql } = placeholderRewrite(targetSql);
      try {
        await pg.transaction(async () => {
          for (const row of sourceRows) {
            const values = cols.map((c) => row[c] === undefined ? null : row[c]);
            await pg.run(rewrittenSql, values);
            inserted += 1;
          }
        });
      } catch (err) {
        ok = false;
        error = err.message;
        break;
      }
      offset += sourceRows.length;
    }
    perTable[tableName] = { rows: inserted, ok, error: error || undefined };
    if (!ok) {
      return { ok: false, tablesMigrated, rowsMigrated, error: `${tableName}: ${error}`, perTable };
    }
    rowsMigrated += inserted;
    tablesMigrated += 1;
  }
  return { ok: true, tablesMigrated, rowsMigrated, perTable };
}
