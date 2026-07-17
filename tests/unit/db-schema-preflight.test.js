import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { verifyApiKeyExpiryColumnShape } from "../../src/lib/db/helpers/schemaVerifier.js";

describe("published schema preflight", () => {
  it("accepts a missing table/column and the published nullable TEXT shape", () => {
    const db = new Database(":memory:");
    expect(() => verifyApiKeyExpiryColumnShape({ get: (sql, params) => db.prepare(sql).get(params), all: (sql) => db.prepare(sql).all() })).not.toThrow();
    db.exec("CREATE TABLE apiKeys (id TEXT PRIMARY KEY, expiresAt TEXT)");
    expect(() => verifyApiKeyExpiryColumnShape({ get: (sql, params) => db.prepare(sql).get(params), all: (sql) => db.prepare(sql).all() })).not.toThrow();
    db.close();
  });

  it.each([
    "expiresAt INTEGER",
    "expiresAt TEXT NOT NULL",
    "expiresAt TEXT DEFAULT 'never'",
  ])("rejects an incompatible pre-existing column: %s", (column) => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, ${column})`);
    const adapter = { get: (sql, params) => db.prepare(sql).get(params), all: (sql) => db.prepare(sql).all() };
    expect(() => verifyApiKeyExpiryColumnShape(adapter)).toThrow("Published schema mismatch");
    db.close();
  });
});
