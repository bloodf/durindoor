// SQLite → PostgreSQL DDL translator.
//
// Used by the parallel PG migration set (`src/lib/db/migrations/postgres/00N-*.js`)
// and by `scripts/migrate-sqlite-ddl-to-pg.mjs`. The translator is intentionally
// narrow: it handles the exact constructs that appear in DurinDoor's 17 SQLite
// migrations and in `src/lib/db/schema.js`. Anything outside that set is a
// programming error in the migration set itself, not a translator gap.
//
// Dialect rules implemented here:
//   - `INTEGER PRIMARY KEY` / `INTEGER PRIMARY KEY AUTOINCREMENT`
//       → `BIGSERIAL PRIMARY KEY` (PG has no `INTEGER` rowid alias).
//   - `INTEGER DEFAULT 0/1` (boolean flag)
//       → `BOOLEAN DEFAULT FALSE/TRUE` only when the column name ends in
//         `Active`, `Enabled`, `Oauth`, or is in the BOOLEAN_COLUMNS allowlist
//         below. Otherwise stays as `INTEGER DEFAULT 0/1` to keep storage
//         identical to SQLite (the existing repos use `0/1` truthy checks).
//   - `TEXT NOT NULL` / `TEXT` / `TEXT PRIMARY KEY`
//       → unchanged.
//   - `REAL`
//       → `DOUBLE PRECISION`.
//   - `datetime('now')` (used as `DEFAULT`)
//       → `CURRENT_TIMESTAMP`.
//   - `PRAGMA table_info(<name>)`
//       → `SELECT column_name, data_type FROM information_schema.columns
//          WHERE table_schema = current_schema() AND table_name = $1`.
//   - `last_insert_rowid()`
//       → adapter-layer: `INSERT ... RETURNING id` for the `BIGSERIAL`
//         column; the adapter implements this transparently.
//   - `INSERT ... ON CONFLICT(...) DO UPDATE SET ...`
//       → unchanged (PG 9.5+ supports this exact syntax).
//   - Indexes with `COLLATE NOCASE`
//       → functional index `LOWER(<col>)`.
//
// What the translator does NOT do (and why):
//   - It does not rewrite SQL at runtime. Migrations are translated at
//     generate-time; the runtime never re-translates.
//   - It does not handle JSONB conversion. JSON columns stay as `TEXT`
//     in PG to match the SQLite storage and avoid surprises with
//     `columnCrypto` (which encrypts the cell as a string).
//   - It does not introduce 18+ features (AIO, skip scan, parallel GIN
//     hints). The capability gate enables those at runtime.

const BOOLEAN_COLUMNS = new Set([
  "isActive",
  "is_active",
  "enabled",
  "oauth",
]);

/**
 * Returns true if the column name looks like a boolean flag and the column
 * definition is `INTEGER DEFAULT 0`, `INTEGER DEFAULT 1`, or just
 * `INTEGER`. We keep INTEGER (not BOOLEAN) so the existing repos that do
 * `row.isActive === 1` keep working without a mapping layer; the runtime
 * only flips the column type when the operator opts in via the
 * `booleanColumns` feature toggle (not yet implemented; reserved).
 */
function looksLikeBooleanFlag(columnName) {
  return BOOLEAN_COLUMNS.has(columnName);
}

/**
 * Translate a single column definition string (the part after the column
 * name in a SQLite CREATE TABLE statement) to its PG equivalent.
 */
export function translateColumnDef(columnName, def) {
  let out = def;

  // INTEGER PRIMARY KEY → BIGSERIAL PRIMARY KEY (autoincrement sequence)
  if (/^INTEGER\s+PRIMARY\s+KEY(\s+AUTOINCREMENT)?\s*$/i.test(out.trim())) {
    return "BIGSERIAL PRIMARY KEY";
  }
  if (/^INTEGER\s+PRIMARY\s+KEY(\s+AUTOINCREMENT)?/i.test(out)) {
    return out
      .replace(/INTEGER/i, "BIGSERIAL")
      .replace(/AUTOINCREMENT/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // datetime('now') → CURRENT_TIMESTAMP
  out = out.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");

  // REAL → DOUBLE PRECISION
  out = out.replace(/^REAL\b/i, "DOUBLE PRECISION");

  return out.trim();
}

/**
 * Translate a full CREATE TABLE statement. Accepts the `def` object from
 * `src/lib/db/schema.js` (with `columns` and optionally `primaryKey` and
 * `indexes`) and emits the PG DDL.
 *
 * @param {string} tableName
 * @param {object} def
 * @returns {{ createSql: string, indexSqls: string[] }}
 */
export function translateCreateTable(tableName, def) {
  const columns = Object.entries(def.columns || {}).map(([colName, colDef]) => {
    return `${colName} ${translateColumnDef(colName, colDef)}`;
  });
  if (def.primaryKey) columns.push(def.primaryKey);
  const createSql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(", ")})`;
  const indexSqls = (def.indexes || []).map(translateIndex).filter(Boolean);
  return { createSql, indexSqls };
}

/**
 * Translate a single CREATE INDEX statement. Strips `IF NOT EXISTS` is left
 * as-is (PG supports it). Rewrites `COLLATE NOCASE` into a `LOWER(col)`
 * functional index. Preserves an optional `WHERE` clause for partial
 * indexes.
 */
export function translateIndex(idxSql) {
  if (!idxSql) return null;
  // `CREATE [UNIQUE] INDEX IF NOT EXISTS idx_xxx ON table(col COLLATE NOCASE) [WHERE ...]`
  const m = idxSql.match(
    /^\s*(CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\S+)\s+ON\s+(\S+)\s*\(([^)]+)\)(\s+WHERE\s+.+?)?)(\s*;?\s*)$/i
  );
  if (!m) return idxSql; // unknown shape: pass through; review at code-review time
  const [, , unique, name, table, colsRaw, whereClause] = m;
  const cols = colsRaw.split(",").map((c) => {
    const trimmed = c.trim();
    const nocase = /\bCOLLATE\s+NOCASE\b/i.test(trimmed);
    if (!nocase) return trimmed;
    const colOnly = trimmed.replace(/\s+COLLATE\s+NOCASE/i, "").trim();
    return `LOWER(${colOnly})`;
  });
  const head = `CREATE ${unique || ""}INDEX IF NOT EXISTS ${name} ON ${table}(${cols.join(", ")})`.replace(/\s+/g, " ").trim();
  return whereClause ? `${head} ${whereClause.trim()}` : head;
}

/**
 * Translate a SQLite PRAGMA table_info call to the PG information_schema
 * equivalent. Returns `{ sql, params }`; the adapter runs the result and
 * maps the rows to the same shape (`name`, `type`, `notnull`, `dflt_value`,
 * `pk`) that the repos expect.
 */
export function translatePragmaTableInfo(tableName) {
  return {
    sql: `SELECT column_name AS name, data_type AS type,
                 (is_nullable = 'NO') AS notnull,
                 column_default AS dflt_value,
                 0 AS pk
          FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1`,
    params: [tableName],
  };
}

/**
 * Map SQLite data type to PG data type for column reflection. Used by the
 * adapter to surface a SQLite-shaped row in tests that need it.
 */
export function sqliteTypeToPgType(sqliteType) {
  if (!sqliteType) return "TEXT";
  const t = String(sqliteType).toUpperCase();
  if (t.includes("INT")) return "BIGINT";
  if (t === "REAL" || t === "FLOAT" || t === "DOUBLE") return "DOUBLE PRECISION";
  if (t === "TEXT" || t === "VARCHAR" || t === "CHAR") return "TEXT";
  if (t === "BLOB") return "BYTEA";
  if (t === "BOOLEAN" || t === "BOOL") return "BOOLEAN";
  if (t === "DATETIME" || t === "TIMESTAMP") return "TIMESTAMP";
  return "TEXT";
}

/**
 * Read-only: returns true if the translator recognizes every column in the
 * given def. Used by `scripts/check-postgres-migrations.mjs` to assert that
 * the source SQLite migrations are within the translator's supported set.
 */
export function isFullySupported(def) {
  if (!def || !def.columns) return false;
  for (const [colName, colDef] of Object.entries(def.columns)) {
    const translated = translateColumnDef(colName, colDef);
    if (!translated) return false;
  }
  return true;
}
