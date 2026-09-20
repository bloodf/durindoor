// The repos emit SQLite-shaped SQL against a camelCase schema. PostgreSQL folds
// unquoted identifiers to lower case, so `SELECT * FROM apiKeys` arrives as
// `apikeys` and fails. rewriteSqliteDml is the single point every statement
// passes through on the way to PG, so it is where the quoting belongs.
//
// This path is PG-only: SQLite adapters never call the rewriter.
import { describe, it, expect } from "vitest";
import { rewriteSqliteDml } from "@/lib/db/dialects/postgres/dmlRewrite.js";

describe("rewriteSqliteDml identifier quoting", () => {
  it("quotes camelCase table names", () => {
    expect(rewriteSqliteDml("SELECT * FROM apiKeys WHERE id = ?")).toBe(
      'SELECT * FROM "apiKeys" WHERE id = ?'
    );
  });

  it("quotes camelCase columns, including qualified ones", () => {
    expect(
      rewriteSqliteDml("SELECT t.comboId FROM usageHistory t WHERE t.connectionId = ?")
    ).toBe('SELECT t."comboId" FROM "usageHistory" t WHERE t."connectionId" = ?');
  });

  it("quotes a table written without a space before its column list", () => {
    // `INSERT INTO providerConnections(id, ...)` is the shape the repos use; an
    // earlier attempt skipped words followed by "(" to avoid touching function
    // calls and silently missed every insert. `id` stays bare: it is already
    // all-lowercase, so folding is a no-op.
    expect(
      rewriteSqliteDml("INSERT INTO providerConnections(id, isActive) VALUES(?, ?)")
    ).toBe('INSERT INTO "providerConnections"(id, "isActive") VALUES(?, ?)');
  });
  it("leaves SQL functions and all-lowercase identifiers alone", () => {
    expect(
      rewriteSqliteDml("SELECT count(*), max(timestamp) FROM kv WHERE scope = ?")
    ).toBe("SELECT count(*), max(timestamp) FROM kv WHERE scope = ?");
  });

  it("never rewrites inside string literals", () => {
    // `combos` is all-lowercase so the table itself needs no quoting; the point
    // here is that the camelCase-looking VALUE must survive untouched.
    const sql = "SELECT * FROM combos WHERE name = 'myComboName'";
    expect(rewriteSqliteDml(sql)).toBe(sql);
  });

  it("handles escaped quotes inside string literals", () => {
    const sql = "SELECT * FROM combos WHERE name = 'it''s myName'";
    expect(rewriteSqliteDml(sql)).toContain("'it''s myName'");
  });

  it("does not double-quote identifiers that are already quoted", () => {
    expect(rewriteSqliteDml('SELECT "comboId" FROM "usageHistory"')).toBe(
      'SELECT "comboId" FROM "usageHistory"'
    );
  });

  it("quotes the conflict target it synthesises for INSERT OR REPLACE", () => {
    const out = rewriteSqliteDml(
      "INSERT OR REPLACE INTO apiKeyProviderConnections(apiKeyId, connectionId) VALUES(?, ?)"
    );
    expect(out).toContain('INSERT INTO "apiKeyProviderConnections"');
    expect(out).toMatch(/ON CONFLICT \("apiKeyId", "connectionId"\)/);
    expect(out).not.toMatch(/ON CONFLICT \(\s*apiKeyId/);
  });

  it("still converts INSERT OR IGNORE to ON CONFLICT DO NOTHING", () => {
    const out = rewriteSqliteDml("INSERT OR IGNORE INTO usageHistory(comboId) VALUES(?)");
    expect(out).toContain('INSERT INTO "usageHistory"("comboId")');
    expect(out).toContain("ON CONFLICT DO NOTHING");
  });

  it("still rewrites COLLATE NOCASE comparisons to LOWER()", () => {
    expect(
      rewriteSqliteDml("SELECT * FROM apiKeyGroups WHERE name = ? COLLATE NOCASE")
    ).toBe('SELECT * FROM "apiKeyGroups" WHERE LOWER(name) = LOWER(?)');
  });
});
