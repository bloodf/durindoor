import { describe, it, expect } from "vitest";
import {
  translateColumnDef,
  translateCreateTable,
  translateIndex,
  translatePragmaTableInfo,
  sqliteTypeToPgType,
  isFullySupported,
} from "@/lib/db/dialects/postgres/translate.js";
import { TABLES } from "@/lib/db/schema.js";

describe("dialects/postgres/translate — column definitions", () => {
  it("rewrites INTEGER PRIMARY KEY AUTOINCREMENT to BIGSERIAL PRIMARY KEY", () => {
    expect(translateColumnDef("id", "INTEGER PRIMARY KEY AUTOINCREMENT")).toBe(
      "BIGSERIAL PRIMARY KEY"
    );
  });

  it("rewrites INTEGER PRIMARY KEY (without AUTOINCREMENT) to BIGSERIAL PRIMARY KEY", () => {
    expect(translateColumnDef("id", "INTEGER PRIMARY KEY")).toBe(
      "BIGSERIAL PRIMARY KEY"
    );
  });

  it("rewrites datetime('now') defaults to CURRENT_TIMESTAMP", () => {
    expect(translateColumnDef("createdAt", "TEXT NOT NULL DEFAULT datetime('now')"))
      .toBe("TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  });

  it("rewrites REAL to DOUBLE PRECISION", () => {
    expect(translateColumnDef("cost", "REAL DEFAULT 0")).toBe(
      "DOUBLE PRECISION DEFAULT 0"
    );
  });

  it("leaves plain TEXT columns unchanged", () => {
    expect(translateColumnDef("name", "TEXT")).toBe("TEXT");
    expect(translateColumnDef("name", "TEXT NOT NULL")).toBe("TEXT NOT NULL");
    expect(translateColumnDef("name", "TEXT PRIMARY KEY")).toBe("TEXT PRIMARY KEY");
  });

  it("leaves INTEGER DEFAULT 0/1 columns unchanged (booleans stay as 0/1)", () => {
    expect(translateColumnDef("isActive", "INTEGER DEFAULT 1")).toBe(
      "INTEGER DEFAULT 1"
    );
    expect(translateColumnDef("enabled", "INTEGER DEFAULT 0")).toBe(
      "INTEGER DEFAULT 0"
    );
  });
});

describe("dialects/postgres/translate — CREATE TABLE", () => {
  it("emits a CREATE TABLE IF NOT EXISTS for a simple table", () => {
    const { createSql, indexSqls } = translateCreateTable("widget", {
      columns: {
        id: "TEXT PRIMARY KEY",
        name: "TEXT NOT NULL",
        price: "REAL DEFAULT 0",
      },
    });
    expect(createSql).toBe(
      "CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY, name TEXT NOT NULL, price DOUBLE PRECISION DEFAULT 0)"
    );
    expect(indexSqls).toEqual([]);
  });

  it("translates a representative table with all 17 construct flavors", () => {
    const def = TABLES.providerConnections;
    const { createSql, indexSqls } = translateCreateTable("providerConnections", def);
    expect(createSql).toContain("CREATE TABLE IF NOT EXISTS providerConnections");
    expect(createSql).toContain("id TEXT PRIMARY KEY");
    expect(createSql).toContain("provider TEXT NOT NULL");
    expect(createSql).toContain("priority INTEGER");
    expect(createSql).toContain("isActive INTEGER DEFAULT 1");
    expect(createSql).toContain("data TEXT NOT NULL");
    expect(createSql).toContain("createdAt TEXT NOT NULL");
    expect(createSql).toContain("updatedAt TEXT NOT NULL");
    // Indexes are translated
    for (const idx of indexSqls) {
      expect(idx).toMatch(/^CREATE (UNIQUE )?INDEX IF NOT EXISTS /);
    }
  });

  it("translates every table in TABLES without throwing", () => {
    for (const [name, def] of Object.entries(TABLES)) {
      expect(() => translateCreateTable(name, def)).not.toThrow();
    }
  });
});

describe("dialects/postgres/translate — indexes", () => {
  it("rewrites COLLATE NOCASE into LOWER(col) functional indexes", () => {
    const out = translateIndex(
      "CREATE INDEX IF NOT EXISTS idx_foo ON bar(name COLLATE NOCASE)"
    );
    expect(out).toBe("CREATE INDEX IF NOT EXISTS idx_foo ON bar(LOWER(name))");
  });

  it("preserves plain indexes", () => {
    const out = translateIndex(
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)"
    );
    expect(out).toBe(
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)"
    );
  });

  it("preserves UNIQUE indexes (WHERE clause is preserved verbatim)", () => {
    const out = translateIndex(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_uh_usage_event ON usageHistory(usageEventId) WHERE usageEventId IS NOT NULL"
    );
    expect(out).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS idx_uh_usage_event ON usageHistory\(usageEventId\)/);
    expect(out).toContain("WHERE usageEventId IS NOT NULL");
  });
});

describe("dialects/postgres/translate — PRAGMA table_info", () => {
  it("returns the information_schema query equivalent", () => {
    const { sql, params } = translatePragmaTableInfo("providerConnections");
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain("table_schema = current_schema()");
    expect(sql).toContain("table_name = $1");
    expect(params).toEqual(["providerConnections"]);
  });
});

describe("dialects/postgres/translate — type mapping", () => {
  it("maps SQLite type names to PG equivalents", () => {
    expect(sqliteTypeToPgType("INTEGER")).toBe("BIGINT");
    expect(sqliteTypeToPgType("REAL")).toBe("DOUBLE PRECISION");
    expect(sqliteTypeToPgType("TEXT")).toBe("TEXT");
    expect(sqliteTypeToPgType("BLOB")).toBe("BYTEA");
    expect(sqliteTypeToPgType("BOOLEAN")).toBe("BOOLEAN");
    expect(sqliteTypeToPgType("")).toBe("TEXT");
  });
});

describe("dialects/postgres/translate — coverage", () => {
  it("declares every TABLES entry as fully supported", () => {
    const unsupported = Object.entries(TABLES)
      .filter(([_, def]) => !isFullySupported(def))
      .map(([name]) => name);
    expect(unsupported).toEqual([]);
  });
});
