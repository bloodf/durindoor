// PostgreSQL folds unquoted identifiers to lower case; SQLite does not. The
// declarative schema is camelCase, so every fragment the DDL translator passes
// through verbatim has to be quoted or a fresh PG bootstrap fails outright.
//
// Each assertion below corresponds to a real failure observed while bringing a
// clean PostgreSQL cluster up from this schema:
//   composite PK   -> column "connectionid" named in key does not exist
//   column CHECK   -> column "limitkind" does not exist
//   REFERENCES     -> relation "providerconnections" does not exist
//   partial index  -> column "comboid" does not exist
import { describe, it, expect } from "vitest";
import {
  translateCreateTable,
  translateColumnDef,
  translateIndex,
} from "@/lib/db/dialects/postgres/translate.js";
import { TABLES } from "@/lib/db/schema.js";

describe("postgres DDL identifier quoting", () => {
  it("quotes camelCase columns in a composite PRIMARY KEY", () => {
    const { createSql } = translateCreateTable("apiKeyProviderConnections", {
      columns: { apiKeyId: "TEXT NOT NULL", connectionId: "TEXT NOT NULL" },
      primaryKey: "PRIMARY KEY (apiKeyId, connectionId)",
    });
    expect(createSql).toContain('PRIMARY KEY ("apiKeyId", "connectionId")');
    expect(createSql).not.toMatch(/PRIMARY KEY \(\s*apiKeyId/);
  });

  it("quotes a camelCase column referenced by its own CHECK", () => {
    const out = translateColumnDef(
      "limitKind",
      "TEXT NOT NULL CHECK (limitKind IN ('bounded','unlimited','unknown'))"
    );
    expect(out).toBe(
      "TEXT NOT NULL CHECK (\"limitKind\" IN ('bounded','unlimited','unknown'))"
    );
  });

  it("keeps string literals inside a CHECK untouched", () => {
    // A value that looks like a camelCase identifier must not be quoted.
    const out = translateColumnDef("kind", "TEXT CHECK (kind IN ('fooBar'))");
    expect(out).toBe("TEXT CHECK (kind IN ('fooBar'))");
  });

  it("quotes nested CHECK expressions without losing parentheses", () => {
    const out = translateColumnDef(
      "limitValue",
      "REAL CHECK (limitValue IS NULL OR (limitValue >= 0 AND limitValue <= 10))"
    );
    expect(out).toBe(
      'DOUBLE PRECISION CHECK ("limitValue" IS NULL OR ("limitValue" >= 0 AND "limitValue" <= 10))'
    );
  });

  it("quotes the table and column of a REFERENCES clause", () => {
    const out = translateColumnDef(
      "connectionId",
      "TEXT NOT NULL REFERENCES providerConnections(id) ON DELETE CASCADE"
    );
    expect(out).toBe(
      'TEXT NOT NULL REFERENCES "providerConnections" ("id") ON DELETE CASCADE'
    );
  });

  it("quotes identifiers in a partial index WHERE clause", () => {
    const out = translateIndex(
      "CREATE INDEX IF NOT EXISTS idx_uh_combo ON usageHistory(comboId) WHERE comboId IS NOT NULL"
    );
    expect(out).toBe(
      'CREATE INDEX IF NOT EXISTS idx_uh_combo ON "usageHistory"("comboId") WHERE "comboId" IS NOT NULL'
    );
  });

  it("leaves autoincrement and singleton primary keys alone", () => {
    expect(translateColumnDef("id", "INTEGER PRIMARY KEY AUTOINCREMENT")).toBe(
      "BIGSERIAL PRIMARY KEY"
    );
    // settings.id must stay a plain INTEGER, never BIGSERIAL.
    expect(translateColumnDef("id", "INTEGER PRIMARY KEY CHECK (id = 1)")).toBe(
      "INTEGER PRIMARY KEY CHECK (id = 1)"
    );
  });

  it("still rewrites COLLATE NOCASE to a LOWER() functional index", () => {
    expect(
      translateIndex("CREATE INDEX IF NOT EXISTS idx_ak ON apiKeys(name COLLATE NOCASE)")
    ).toBe('CREATE INDEX IF NOT EXISTS idx_ak ON "apiKeys"(LOWER("name"))');
  });

  it("widens SQLite INTEGER counters to BIGINT so 64-bit values survive", () => {
    // Observed in production: apiKeyUsageTotals.totalTokens reached 60,526,220,870
    // and the cutover aborted with `out of range for type integer`.
    expect(translateColumnDef("totalTokens", "INTEGER NOT NULL DEFAULT 0")).toBe(
      "BIGINT NOT NULL DEFAULT 0"
    );
  });

  it("emits no unquoted camelCase identifier for any real table in the schema", () => {
    const offenders = [];
    for (const [name, def] of Object.entries(TABLES)) {
      const { createSql, indexSqls } = translateCreateTable(name, def);
      for (const sql of [createSql, ...indexSqls]) {
        // Strip quoted identifiers and string literals, then look for a
        // surviving camelCase word — that is an identifier PG would fold.
        const stripped = sql.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
        const bare = stripped.match(/\b[a-z]+[A-Z][A-Za-z0-9_]*\b/g);
        if (bare) offenders.push(`${name}: ${bare.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
