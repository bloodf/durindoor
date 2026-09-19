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

/**
 * Quote every bare camelCase identifier in a SQL fragment.
 *
 * PostgreSQL folds unquoted identifiers to lower case; SQLite does not. The
 * repos emit SQLite-shaped SQL against a camelCase schema (`SELECT * FROM
 * apiKeys`), which reaches PG as `apikeys` and fails with `relation "apikeys"
 * does not exist`. Quoting here — at the single point every statement passes
 * through on its way to PG — keeps the repos dialect-agnostic.
 *
 * Skips single-quoted string literals (so a value that merely looks like an
 * identifier is untouched) and identifiers that are already quoted.
 * All-lowercase words are left alone: folding is a no-op for them, and quoting
 * them would only add churn. Shared with the DDL translator so both paths
 * follow exactly one rule.
 */
export function quoteCamelIdents(fragment) {
  if (!fragment) return fragment;
  const text = String(fragment);
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < text.length) {
    const ch = text[i];
    if (inSingle) {
      out += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") out += text[++i];
        else inSingle = false;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (ch === "'") { inSingle = true; out += ch; i += 1; continue; }
    if (ch === '"') { inDouble = true; out += ch; i += 1; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      out += /^[a-z]+[A-Z][A-Za-z0-9_]*$/.test(word) ? quoteIdent(word) : word;
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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

  // Quote last, over the finished statement, so the conflict targets and
  // `excluded.<col>` references this function just synthesised are covered by
  // the same rule as the caller's original SQL.
  return quoteCamelIdents(out);
}
