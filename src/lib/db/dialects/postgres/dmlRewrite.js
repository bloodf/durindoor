// Runtime SQLite → PostgreSQL DML rewrite.
//
// The DDL translator runs at generate-time. Repos still emit SQLite DML
// (`INSERT OR IGNORE`, `datetime('now')`, `COLLATE NOCASE`). The PG
// adapter rewrites those shapes before sending the statement so the
// existing sync repos keep working on both engines.

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
      const cols = splitSqlByComma(m[2]);
      if (cols.length) {
        const pk = cols[0];
        const sets = cols.map((c) => `${c} = excluded.${c.replace(/"/g, "")}`).join(", ");
        out = out.replace(/;?\s*$/, ` ON CONFLICT (${pk}) DO UPDATE SET ${sets}`);
      }
    }
  }

  return out;
}
