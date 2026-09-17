import { describe, it, expect } from "vitest";
import { rewriteSqliteDml, quoteIdent } from "@/lib/db/dialects/postgres/dmlRewrite.js";

describe("dialects/postgres/dmlRewrite", () => {
  it("quotes camelCase identifiers", () => {
    expect(quoteIdent("isActive")).toBe('"isActive"');
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });

  it("rewrites INSERT OR IGNORE to ON CONFLICT DO NOTHING", () => {
    const out = rewriteSqliteDml("INSERT OR IGNORE INTO usageHistory(timestamp) VALUES(?)");
    expect(out).toMatch(/^INSERT INTO usageHistory\(timestamp\) VALUES\(\?\)/);
    expect(out).toContain("ON CONFLICT DO NOTHING");
  });

  it("rewrites INSERT OR REPLACE with a column list to ON CONFLICT DO UPDATE", () => {
    const out = rewriteSqliteDml(
      "INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)"
    );
    expect(out).toContain("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)");
    expect(out).toContain("ON CONFLICT (scope) DO UPDATE SET");
    expect(out).toContain("value = excluded.value");
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
