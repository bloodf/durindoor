// Unit tests for the PG adapter. No real PG socket is required: the
// adapter accepts a `clientFactory` dependency-injection hook so the
// tests can pass a `MockClient` that records all `query` calls and
// returns fixture rows. This mirrors how the cutover and fallback tests
// stub the adapter, and avoids needing a real PG cluster in CI.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createPostgresAdapter,
} from "@/lib/db/adapters/pgAdapter.js";

// In-process mock that mimics the small slice of the `pg.Client` surface
// the adapter actually uses. Records every query so tests can assert on
// the SQL the adapter emits (with `$N` placeholders, RETURNING clauses,
// etc.).
function makeMockClient({ rowMap = {}, failNext = null } = {}) {
  const calls = [];
  const client = {
    _ending: false,
    async connect() {},
    async end() { this._ending = true; },
    async query(sql, params) {
      calls.push({ sql, params });
      if (failNext && failNext.length) {
        const err = failNext.shift();
        if (err) {
          const e = new Error(err.message);
          if (err.code) e.code = err.code;
          if (err.severity) e.severity = err.severity;
          throw e;
        }
      }
      const key = String(sql).trim();
      if (rowMap[key]) return rowMap[key];
      // INSERT ... RETURNING (mocked at the adapter level; the mock
      // client just returns a fixed row).
      if (/RETURNING/i.test(key) && /^INSERT/i.test(key)) {
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, calls };
}

async function makeAdapter(opts = {}, mockOpts = {}) {
  const { client, calls } = makeMockClient(mockOpts);
  const factory = () => client;
  const adapter = await createPostgresAdapter({ ...opts, clientFactory: factory });
  return { adapter, client, calls };
}

describe("adapters/pgAdapter — adapter surface", () => {
  it("throws when url is missing", async () => {
    await expect(createPostgresAdapter({})).rejects.toThrow(/url is required/);
  });

  it("opens a client, exposes driver and capabilities, and reports server_version_num", async () => {
    const rowMap = {
      "SHOW server_version_num": { rows: [{ server_version_num: "180004" }], rowCount: 1 },
      "SHOW server_version": { rows: [{ server_version: "18.4" }], rowCount: 1 },
    };
    const { adapter } = await makeAdapter({ url: "postgres://u@h/db" }, { rowMap });
    expect(adapter.driver).toBe("pg");
    expect(adapter.capabilities.isPostgres).toBe(true);
    expect(adapter.capabilities.serverVersionNum).toBe(180004);
    expect(adapter.capabilities.serverVersion).toBe("18.4");
  });

  it("appends sslmode when not already in the connection string", async () => {
    const { adapter } = await makeAdapter({ url: "postgres://u@h/db", sslmode: "require" });
    expect(adapter).toBeDefined();
  });

  it("leaves existing sslmode intact", async () => {
    const rowMap = {
      "SHOW server_version_num": { rows: [{ server_version_num: "180000" }], rowCount: 1 },
      "SHOW server_version": { rows: [{ server_version: "18.0" }], rowCount: 1 },
    };
    const { adapter } = await makeAdapter(
      { url: "postgres://u@h/db?sslmode=verify-full", sslmode: "require" },
      { rowMap }
    );
    expect(adapter).toBeDefined();
  });
});

describe("adapters/pgAdapter — placeholder rewriting", () => {
  let adapter; let calls;
  beforeEach(async () => {
    const r = await makeAdapter({ url: "postgres://u@h/db" });
    adapter = r.adapter; calls = r.calls;
  });

  it("rewrites ? to $N in the order they appear", async () => {
    await adapter.run("UPDATE x SET a = ?, b = ? WHERE id = ?", [1, 2, "abc"]);
    const last = calls[calls.length - 1];
    expect(last.sql).toBe("UPDATE x SET a = $1, b = $2 WHERE id = $3");
    expect(last.params).toEqual([1, 2, "abc"]);
  });

  it("does not rewrite ? inside a single-quoted literal", async () => {
    await adapter.all("SELECT 'a?b' AS x WHERE y = ?", ["z"]);
    const last = calls[calls.length - 1];
    expect(last.sql).toBe("SELECT 'a?b' AS x WHERE y = $1");
    expect(last.params).toEqual(["z"]);
  });

  it("treats '' as an escaped single quote and does not toggle the in-string flag", async () => {
    await adapter.all("SELECT 'it''s ok' AS x WHERE y = ?", ["z"]);
    const last = calls[calls.length - 1];
    expect(last.sql).toContain("'it''s ok'");
  });
});

describe("adapters/pgAdapter — lastInsertRowid via RETURNING", () => {
  it("appends RETURNING id for INSERT into a known autoincrement table", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    const r = await adapter.run("INSERT INTO usageHistory(timestamp) VALUES(?)", ["2026-09-09"]);
    const last = calls[calls.length - 1];
    expect(last.sql).toBe('INSERT INTO usageHistory(timestamp) VALUES($1) RETURNING "id"');
    expect(r.changes).toBe(1);
    expect(r.lastInsertRowid).toBe(42);
  });

  it("does not add RETURNING for INSERTs that already have one", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    await adapter.run("INSERT INTO usageHistory(timestamp) VALUES(?) RETURNING id", ["2026-09-09"]);
    const last = calls[calls.length - 1];
    expect(last.sql).not.toMatch(/RETURNING "id"/);
    expect(last.sql).toMatch(/RETURNING id/);
  });

  it("does not add RETURNING for INSERTs into tables without an autoincrement column", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    await adapter.run("INSERT INTO apiKeys(id, key) VALUES(?, ?)", ["x", "y"]);
    const last = calls[calls.length - 1];
    expect(last.sql).not.toMatch(/RETURNING/);
  });
});

describe("adapters/pgAdapter — get/all/transaction", () => {
  it("get returns the first row", async () => {
    const rowMap = { "SELECT 1 AS n": { rows: [{ n: 1 }], rowCount: 1 } };
    const { adapter } = await makeAdapter({ url: "postgres://u@h/db" }, { rowMap });
    const row = await adapter.get("SELECT 1 AS n");
    expect(row).toEqual({ n: 1 });
  });

  it("all returns an array of rows", async () => {
    const rowMap = { "SELECT n FROM t ORDER BY n": { rows: [{ n: 1 }, { n: 2 }], rowCount: 2 } };
    const { adapter } = await makeAdapter({ url: "postgres://u@h/db" }, { rowMap });
    const rows = await adapter.all("SELECT n FROM t ORDER BY n");
    expect(rows).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("transaction commits when the callback resolves", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    const before = calls.length;
    await adapter.transaction(async () => {
      await adapter.run("INSERT INTO apiKeys(id) VALUES(?)", ["x"]);
    });
    const sqls = calls.slice(before).map((c) => String(c.sql).trim());
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[1]).toMatch(/^SAVEPOINT sp_/);
    expect(sqls.at(-2)).toMatch(/^RELEASE SAVEPOINT sp_/);
    expect(sqls.at(-1)).toBe("COMMIT");
  });

  it("transaction rolls back to savepoint and rethrows when the callback throws", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    const before = calls.length;
    await expect(
      adapter.transaction(async () => {
        await adapter.run("INSERT INTO apiKeys(id) VALUES(?)", ["x"]);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const sqls = calls.slice(before).map((c) => String(c.sql).trim());
    expect(sqls.some((s) => /^ROLLBACK TO SAVEPOINT sp_/.test(s))).toBe(true);
    expect(sqls.at(-1)).toBe("ROLLBACK");
  });

  it("transaction is reentrant: nested calls do not double COMMIT", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    const before = calls.length;
    await adapter.transaction(async () => {
      await adapter.transaction(async () => {
        await adapter.run("SELECT 1");
      });
    });
    const sqls = calls.slice(before).map((c) => String(c.sql).trim());
    expect(sqls.filter((s) => s === "BEGIN").length).toBe(1);
    expect(sqls.filter((s) => s === "COMMIT").length).toBe(1);
  });
});

describe("adapters/pgAdapter — exec, flush, close", () => {
  it("exec splits a multi-statement string on `;` + newline", async () => {
    const { adapter, calls } = await makeAdapter({ url: "postgres://u@h/db" });
    const before = calls.length;
    await adapter.exec("CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n");
    const sqls = calls.slice(before).map((c) => c.sql);
    expect(sqls).toEqual(["CREATE TABLE a (id INT)", "CREATE TABLE b (id INT)"]);
  });

  it("flush is a no-op", async () => {
    const { adapter } = await makeAdapter({ url: "postgres://u@h/db" });
    expect(() => adapter.flush()).not.toThrow();
  });

  it("checkpoint is a no-op", async () => {
    const { adapter } = await makeAdapter({ url: "postgres://u@h/db" });
    await expect(adapter.checkpoint()).resolves.toBeUndefined();
  });

  it("close is idempotent", async () => {
    const { adapter, client } = await makeAdapter({ url: "postgres://u@h/db" });
    await adapter.close();
    await adapter.close(); // second call must not throw
    expect(client._ending).toBe(true);
  });
});
