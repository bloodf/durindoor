import { describe, it, expect } from "vitest";
import { rewriteSqliteDml, quoteIdent } from "@/lib/db/dialects/postgres/dmlRewrite.js";

describe("dialects/postgres/dmlRewrite", () => {
  it("quotes camelCase identifiers", () => {
    expect(quoteIdent("isActive")).toBe('"isActive"');
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });

  it("rewrites INSERT OR IGNORE to ON CONFLICT DO NOTHING", () => {
    const out = rewriteSqliteDml("INSERT OR IGNORE INTO usageHistory(timestamp) VALUES(?)");
    // The table is quoted now: PG folds bare identifiers to lower case, so
    // `usageHistory` would arrive as `usagehistory` and the statement fails.
    expect(out).toMatch(/^INSERT INTO "usageHistory"\(timestamp\) VALUES\(\?\)/);
    expect(out).toContain("ON CONFLICT DO NOTHING");
  });

  it("targets the full composite primary key on INSERT OR REPLACE", () => {
    // `kv` is PRIMARY KEY (scope, key). Naming only `scope` is not a unique
    // constraint, so PG rejects the upsert with 42P10.
    const out = rewriteSqliteDml(
      "INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)"
    );
    expect(out).toContain("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)");
    expect(out).toContain('ON CONFLICT ("scope", "key") DO UPDATE SET');
    expect(out).toContain("value = excluded.value");
    // Key columns are the conflict target; assigning them to themselves is a no-op.
    expect(out).not.toContain("scope = excluded.scope");
  });

  it("targets the declared single-column primary key", () => {
    const out = rewriteSqliteDml(
      "INSERT OR REPLACE INTO combos(id, name) VALUES(?, ?)"
    );
    expect(out).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(out).toContain("name = excluded.name");
  });

  it("falls back to the first column for a table outside the schema", () => {
    const out = rewriteSqliteDml(
      "INSERT OR REPLACE INTO notATable(a, b) VALUES(?, ?)"
    );
    expect(out).toContain('ON CONFLICT ("a") DO UPDATE SET b = excluded.b');
  });

  it("rewrites datetime('now') to CURRENT_TIMESTAMP", () => {
    expect(rewriteSqliteDml("INSERT INTO t(at) VALUES(datetime('now'))")).toBe(
      "INSERT INTO t(at) VALUES(CURRENT_TIMESTAMP)"
    );
  });

  it("rewrites COLLATE NOCASE comparisons to LOWER()", () => {
    expect(rewriteSqliteDml("SELECT * FROM g WHERE name = ? COLLATE NOCASE")).toBe(
      "SELECT * FROM g WHERE LOWER(name) = LOWER(?)"
    );
  });
});
