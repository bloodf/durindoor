import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import m027 from "@/lib/db/migrations/027-api-key-admin-scope.js";

function adapter(db) {
  return { all: (sql, params = []) => db.prepare(sql).all(...params), exec: (sql) => db.exec(sql) };
}

describe("api-key-admin-scope migration", () => {
  it("is registered after the proxy timeline migration", async () => {
    const { MIGRATIONS } = await import("@/lib/db/migrations/index.js");
    expect(MIGRATIONS.find(({ version }) => version === 27)?.name).toBe("api-key-admin-scope");
  });

  it("adds isAdmin defaulting existing keys to 0, idempotently", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL)`);
    db.exec(`INSERT INTO apiKeys(id, key) VALUES('k1', 'sk-old')`);
    m027.up(adapter(db));
    m027.up(adapter(db));
    const columns = db.prepare(`PRAGMA table_info(apiKeys)`).all().filter((row) => row.name === "isAdmin");
    expect(columns).toHaveLength(1);
    expect(db.prepare(`SELECT isAdmin FROM apiKeys WHERE id = 'k1'`).get().isAdmin).toBe(0);
  });

  it("does nothing when the apiKeys table does not exist yet", () => {
    const db = new Database(":memory:");
    expect(() => m027.up(adapter(db))).not.toThrow();
  });
});
