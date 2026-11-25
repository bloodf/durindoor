import { createHash } from "node:crypto";
import { USAGE_COST_FIELDS } from "../../../shared/utils/usageCostAllocation.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

const GROUPS = ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"];
const TOKEN_AND_COST_FIELDS = ["promptTokens", "completionTokens", "cachedTokens", "reasoningTokens", "cacheCreationTokens", "cost"];
const COUNTERS = [
  "requests", ...TOKEN_AND_COST_FIELDS, "unknownCostRequests",
  "latencyMs", "ttftMs", "latencySamples", "ttftSamples", "timedCompletionTokens", ...USAGE_COST_FIELDS,
];
const unsplitColumn = (field) => `unsplit${field[0].toUpperCase()}${field.slice(1)}`;
export const USAGE_DAILY_ROLLUP_SUMS = [...COUNTERS, ...TOKEN_AND_COST_FIELDS.map(unsplitColumn)];
const COLUMNS = ["dateKey", "dimension", "keyHash", "bucketKey", "metadata", "unsplitMixed", ...USAGE_DAILY_ROLLUP_SUMS];
const TABLE = "usageDailyRollups";
const TOTAL = "total";

export const USAGE_DAILY_ROLLUP_TABLE = {
  columns: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    dateKey: "TEXT NOT NULL",
    dimension: "TEXT NOT NULL",
    keyHash: "TEXT NOT NULL",
    bucketKey: "TEXT NOT NULL",
    metadata: "TEXT NOT NULL",
    unsplitMixed: "INTEGER",
    ...Object.fromEntries(USAGE_DAILY_ROLLUP_SUMS.map((field) => [field, "REAL"])),
  },
  indexes: [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_rollup_bucket ON usageDailyRollups(dateKey, dimension, keyHash)",
    "CREATE INDEX IF NOT EXISTS idx_usage_rollup_order ON usageDailyRollups(dateKey, id)",
    "CREATE INDEX IF NOT EXISTS idx_usage_rollup_totals ON usageDailyRollups(dateKey, id) WHERE dimension = 'total'",
  ],
};

function encode(dateKey, dimension, key, bucket) {
  const { unsplit, ...metadata } = bucket;
  const counters = COUNTERS.map((field) => {
    const value = metadata[field];
    delete metadata[field];
    return value ?? null;
  });
  // PostgreSQL index keys have a byte limit. Keep the original key in a
  // separate text column and index a fixed-size digest, even for long models.
  const bucketKey = stringifyJson(key);
  const keyHash = createHash("sha256").update(bucketKey).digest("hex");
  return [dateKey, dimension, keyHash, bucketKey, stringifyJson(metadata),
    unsplit?.mixed ? 1 : null, ...counters,
    ...TOKEN_AND_COST_FIELDS.map((field) => unsplit?.[field] ?? null)];
}

function* dayBuckets(dateKey, day) {
  const total = { ...day };
  for (const group of GROUPS) delete total[group];
  yield encode(dateKey, TOTAL, "", total);
  for (const group of GROUPS) {
    for (const [key, bucket] of Object.entries(day[group] || {})) yield encode(dateKey, group, key, bucket);
  }
}

function nullableSum(field, previous = `${TABLE}.${field}`) {
  return `${field} = CASE WHEN excluded.${field} IS NULL THEN ${previous}
    ELSE COALESCE(${previous}, 0) + excluded.${field} END`;
}

const CONFLICT_UPDATE = [
  "metadata = excluded.metadata",
  `unsplitMixed = COALESCE(excluded.unsplitMixed, ${TABLE}.unsplitMixed)`,
  ...COUNTERS.map((field) => nullableSum(field)),
  ...TOKEN_AND_COST_FIELDS.map((field) => {
    // Older buckets can have spend with neither a cost split nor an explicit
    // unsplit remainder. Preserve addCostSplit's transition on the first split.
    const previous = `CASE WHEN excluded.inputCost IS NOT NULL AND ${TABLE}.inputCost IS NULL
      AND ${TABLE}.unsplitCost IS NULL AND ${TABLE}.cost > 0
      THEN COALESCE(${TABLE}.${field}, 0) ELSE ${TABLE}.${unsplitColumn(field)} END`;
    return nullableSum(unsplitColumn(field), previous);
  }),
].join(", ");

const PLACEHOLDERS = `(${COLUMNS.map(() => "?").join(", ")})`;
const BATCH_SIZE = 32;

function insertBuckets(db, rows, conflict) {
  db.run(`INSERT INTO ${TABLE}(${COLUMNS.join(", ")})
    VALUES ${rows.map(() => PLACEHOLDERS).join(", ")}
    ON CONFLICT(dateKey, dimension, keyHash) ${conflict}`, rows.flat());
}

/**
 * A request contributes a fixed number of buckets, independent of how many
 * distinct dimensions the day already contains. The caller owns the same
 * transaction as the history write (or the accepted-request settlement).
 */
export function incrementUsageDailyRollup(db, dateKey, delta) {
  insertBuckets(db, [...dayBuckets(dateKey, delta)], `DO UPDATE SET ${CONFLICT_UPDATE}`);
}

/** Store a complete day during migration or a boundary-day rebuild. */
export function insertUsageDailyRollup(db, dateKey, day) {
  let batch = [];
  for (const row of dayBuckets(dateKey, day)) {
    batch.push(row);
    if (batch.length === BATCH_SIZE) {
      insertBuckets(db, batch, "DO NOTHING");
      batch = [];
    }
  }
  if (batch.length) insertBuckets(db, batch, "DO NOTHING");
}

function decode(row) {
  const bucket = parseJson(row.metadata, {});
  for (const field of COUNTERS) {
    if (row[field] !== null) bucket[field] = row[field];
  }
  const unsplit = {};
  for (const field of TOKEN_AND_COST_FIELDS) {
    const value = row[unsplitColumn(field)];
    if (value !== null) unsplit[field] = value;
  }
  if (row.unsplitMixed) unsplit.mixed = true;
  if (Object.keys(unsplit).length) bucket.unsplit = unsplit;
  return bucket;
}

/** Reassemble the legacy day shape in bounded result pages on both engines. */
export function* readUsageDailyRollups(db, where = "1 = 1", params = [], totalsOnly = false) {
  const pageSize = 256;
  let after = [];
  let current;
  for (;;) {
    const rows = db.all(`SELECT * FROM ${TABLE} WHERE ${where}
      ${totalsOnly ? "AND dimension = 'total'" : ""}
      ${after.length ? "AND (dateKey, id) > (?, ?)" : ""}
      ORDER BY dateKey, id LIMIT ?`, [...params, ...after, pageSize]);
    for (const row of rows) {
      if (row.dimension === TOTAL) {
        if (current && current.dateKey !== row.dateKey) yield current;
        const day = decode(row);
        if (!totalsOnly) for (const group of GROUPS) day[group] = {};
        current = { dateKey: row.dateKey, day };
      } else {
        const key = parseJson(row.bucketKey);
        Object.defineProperty(current.day[row.dimension], key, {
          value: decode(row), enumerable: true, configurable: true, writable: true,
        });
      }
    }
    if (rows.length < pageSize) break;
    const last = rows[rows.length - 1];
    after = [last.dateKey, last.id];
  }
  if (current) yield current;
}
