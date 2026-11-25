import { buildCreateTableSql } from "../schema.js";
import { translateCreateTable } from "../dialects/postgres/translate.js";
import { tableColumnNames } from "../helpers/tableColumns.js";
import { parseJson } from "../helpers/jsonCol.js";
import { insertUsageDailyRollup, USAGE_DAILY_ROLLUP_TABLE } from "../helpers/usageDailyRollups.js";

// A single legacy day can exceed the PostgreSQL sync bridge response limit.
// Read bounded character slices before parsing so migration can handle it.
function readLegacyDay(db, dateKey) {
  if (db.driver !== "pg") return db.get("SELECT data FROM usageDaily WHERE dateKey = ?", [dateKey]).data;
  const chunkSize = 128 * 1024;
  const { length } = db.get("SELECT LENGTH(data) AS length FROM usageDaily WHERE dateKey = ?", [dateKey]);
  const chunks = [];
  for (let start = 1; start <= length; start += chunkSize) {
    const { chunk } = db.get("SELECT SUBSTR(data, ?, ?) AS chunk FROM usageDaily WHERE dateKey = ?",
      [start, chunkSize, dateKey]);
    chunks.push(chunk);
  }
  return chunks.join("");
}

// Called inside the migration/import transaction. A blob remains intact
// until its rows have been stored. Failure rolls back both sides and retry
// has no completed blobs left to count twice.
export function convertLegacyUsageDaily(db) {
  if (!tableColumnNames(db, "usageDaily").size) return;
  let after = null;
  for (;;) {
    const row = db.get(`SELECT dateKey FROM usageDaily
      ${after === null ? "" : "WHERE dateKey > ?"} ORDER BY dateKey LIMIT 1`, after === null ? [] : [after]);
    if (!row) return;
    insertUsageDailyRollup(db, row.dateKey, parseJson(readLegacyDay(db, row.dateKey), {}) || {});
    db.run("DELETE FROM usageDaily WHERE dateKey = ?", [row.dateKey]);
    after = row.dateKey;
  }
}

const migration = {
  version: 37,
  name: "usage-daily-rollups",
  up(db) {
    const table = "usageDailyRollups";
    const schema = USAGE_DAILY_ROLLUP_TABLE;
    const { createSql, indexSqls } = db.driver === "pg"
      ? translateCreateTable(table, schema)
      : { createSql: buildCreateTableSql(table, schema), indexSqls: schema.indexes };
    db.exec(createSql);
    for (const sql of indexSqls) db.exec(sql);
    convertLegacyUsageDaily(db);
  },
};

export default migration;
