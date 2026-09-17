// Runtime SQLite → PostgreSQL DML rewrite.
//
// The DDL translator runs at generate-time. Repos still emit SQLite DML
// (`INSERT OR IGNORE`, `datetime('now')`, `COLLATE NOCASE`). The PG
// adapter rewrites those shapes before sending the statement so the
// existing sync repos keep working on both engines.

import { TABLES } from "../../schema.js";

/**
 * Quote a PG identifier, preserving camelCase that unquoted names would fold.
 */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function splitSqlByComma(list) {
  return String(list)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Columns of a table's declared primary key, or null when the table is
 * unknown. `TABLES` is the same declarative schema the DDL translator and
 * `syncSchemaFromTables` build from, so the conflict target a rewritten
 * upsert names always matches the key PG actually created.
 */
function primaryKeyColumns(table) {
  const def = TABLES[table];
  if (!def) return null;
  const composite = def.primaryKey &&
    String(def.primaryKey).match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
  if (composite) return splitSqlByComma(composite[1]).map((c) => c.replace(/"/g, ""));
  const inline = Object.entries(def.columns || {}).
    find(([, type]) => /PRIMARY\s+KEY/i.test(String(type)));
  return inline ? [inline[0]] : null;
}

/**
 * Rewrite a single SQLite-shaped DML/DDL statement into PG SQL.
 * Placeholders stay as `?`; the adapter rewrites those to `$n` next.
 */
export function rewriteSqliteDml(sql) {
  if (!sql) return sql;
  let out = String(sql);
  const orIgnore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out);
  const orReplace = /^\s*INSERT\s+OR\s+REPLACE\s+INTO\b/i.test(out);
  if (orIgnore || orReplace) {
    out = out.replace(/^\s*INSERT\s+OR\s+(?:IGNORE|REPLACE)\s+INTO\b/i, "INSERT INTO");
  }

  out = out.replace(/datetime\s*\(\s*'now'\s*\)/gi, "CURRENT_TIMESTAMP");

  // `col = ? COLLATE NOCASE` → `LOWER(col) = LOWER(?)` (PG has no NOCASE).
  out = out.replace(
    /([A-Za-z_][\w.]*)\s*=\s*(\?|\$\d+)\s+COLLATE\s+NOCASE\b/gi,
    "LOWER($1) = LOWER($2)"
  );
  out = out.replace(/\s+COLLATE\s+NOCASE\b/gi, "");

  if (orIgnore && !/\bON\s+CONFLICT\b/i.test(out)) {
    out = out.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  }

  if (orReplace && !/\bON\s+CONFLICT\b/i.test(out)) {
    const m = out.match(
      /INSERT\s+INTO\s+("?[\w]+"?)\s*\(([^)]+)\)\s*VALUES/i
    );
    if (m) {
      const table = m[1].replace(/"/g, "");
      const cols = splitSqlByComma(m[2]);
      // The conflict target must name a real unique constraint. Composite-PK
      // tables (kv, apiKeyGroupMembers, …) would otherwise get `ON CONFLICT
      // (firstColumn)`, which PG rejects with 42P10 because a prefix of a
      // composite key is not itself unique. Take the declared key.
      const target = primaryKeyColumns(table) || cols.slice(0, 1);
      if (cols.length && target.length) {
        // Assigning the conflict columns to themselves is a no-op; update the
        // remaining columns, which is what INSERT OR REPLACE does.
        const updatable = cols.filter(
          (c) => !target.includes(c.replace(/"/g, ""))
        );
        const conflict = target.map(quoteIdent).join(", ");
        if (!updatable.length) {
          out = out.replace(/;?\s*$/, ` ON CONFLICT (${conflict}) DO NOTHING`);
        } else {
          const sets = updatable.
            map((c) => `${c} = excluded.${c.replace(/"/g, "")}`).
            join(", ");
          out = out.replace(
            /;?\s*$/,
            ` ON CONFLICT (${conflict}) DO UPDATE SET ${sets}`
          );
        }
      }
    }
  }

  return out;
}
