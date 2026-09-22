// PostgreSQL rejects a SELECT-list alias inside HAVING (`column "x" does not
// exist`); SQLite accepts it. The repos run the same SQL on both engines, so a
// HAVING clause must repeat the aggregate expression instead of naming its
// alias. This guard needs no live cluster: it scans every SQL template in
// src/ for the pattern that broke provider-connection deletes on PG.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

/** Aliases a HAVING clause names, given the full statement text. */
function havingAliasRefs(sql) {
  const having = sql.match(/\bHAVING\b([\s\S]*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/i);
  if (!having) return [];
  const aliases = [...sql.matchAll(/\bAS\s+"?([A-Za-z_]\w*)"?/gi)].map((m) => m[1]);
  return aliases.filter((alias) => new RegExp(`\\b${alias}\\b`).test(having[1]));
}

describe("SQL portable to PostgreSQL: no SELECT alias in HAVING", () => {
  it("detects the alias shape it guards against", () => {
    expect(havingAliasRefs("SELECT a, COUNT(*) AS n FROM t GROUP BY a HAVING n > 1")).toEqual(["n"]);
    expect(havingAliasRefs("SELECT a, COUNT(*) AS n FROM t GROUP BY a HAVING COUNT(*) > 1")).toEqual([]);
  });

  it("finds no HAVING clause in src/ that names a SELECT alias", () => {
    const offenders = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, "utf8");
      for (const [sql] of text.matchAll(/`[^`]*\bHAVING\b[^`]*`/g)) {
        const refs = havingAliasRefs(sql);
        if (refs.length) offenders.push(`${path.relative(SRC_DIR, file)}: ${refs.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
