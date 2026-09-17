import { describe, it, expect } from "vitest";
import { runMirror } from "@/lib/db/dialects/postgres/mirror.js";

function makeMem(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  return {
    tables,
    get(sql, params = []) {
      const count = sql.match(/COUNT\(\*\) AS c FROM "(\w+)"/);
      if (count) return { c: (tables[count[1]] || []).length };
      return undefined;
    },
    all(sql, params = []) {
      const sel = sql.match(/FROM "(\w+)"/);
      if (!sel) return [];
      const rows = tables[sel[1]] || [];
      if (/WHERE key <>/.test(sql)) {
        return rows.filter((r) => r.key !== params[0]).map((r) => ({ key: r.key }));
      }
      const limit = sql.match(/LIMIT \? OFFSET \?/);
      if (limit) {
        const [chunk, offset] = params;
        return rows.slice(offset, offset + chunk);
      }
      return rows;
    },
    run(sql, params = []) {
      const ins = sql.match(/INSERT INTO "(\w+)" \(([^)]+)\)/);
      if (!ins) return { changes: 0 };
      const table = ins[1];
      const cols = ins[2].split(",").map((c) => c.trim().replace(/"/g, ""));
      const row = {};
      cols.forEach((c, i) => { row[c] = params[i]; });
      tables[table] = tables[table] || [];
      tables[table].push(row);
      return { changes: 1 };
    },
    exec(sql) {
      const tr = sql.match(/TRUNCATE TABLE "(\w+)"/);
      if (tr) tables[tr[1]] = [];
    },
    transaction(fn) { return fn(); },
  };
}

describe("postgres mirror", () => {
  it("truncates, copies quoted camelCase columns, and fails on COUNT mismatch", async () => {
    const sqlite = makeMem({
      providerConnections: [
        { id: "a", provider: "x", authType: "key", isActive: 1, data: "{}", createdAt: "t", updatedAt: "t" },
      ],
    });
    const pg = makeMem({
      providerConnections: [{ id: "stale", provider: "old", authType: "key", isActive: 0, data: "{}", createdAt: "t", updatedAt: "t" }],
    });
    // TABLES has many tables; seed empty arrays so COUNT is 0 and TRUNCATE is a no-op.
    const { TABLES } = await import("@/lib/db/schema.js");
    for (const name of Object.keys(TABLES)) {
      sqlite.tables[name] = sqlite.tables[name] || [];
      pg.tables[name] = pg.tables[name] || [];
    }
    sqlite.tables.providerConnections = [
      { id: "a", provider: "x", authType: "key", name: null, email: null, priority: null, isActive: 1, data: "{}", createdAt: "t", updatedAt: "t" },
    ];

    const out = await runMirror(sqlite, pg, { chunkSize: 10 });
    expect(out.ok).toBe(true);
    expect(pg.tables.providerConnections.some((r) => r.id === "stale")).toBe(false);
    expect(pg.tables.providerConnections.some((r) => r.id === "a" && r.isActive === 1)).toBe(true);
  });

  it("copies _meta keys except schemaVersion", async () => {
    const { TABLES } = await import("@/lib/db/schema.js");
    const sqlite = makeMem({});
    const pg = makeMem({});
    for (const name of Object.keys(TABLES)) {
      sqlite.tables[name] = [];
      pg.tables[name] = [];
    }
    sqlite.tables._meta = [
      { key: "schemaVersion", value: "18" },
      { key: "usageIdentitySalt", value: "salt-from-sqlite" },
    ];
    pg.tables._meta = [{ key: "schemaVersion", value: "19" }];
    const out = await runMirror(sqlite, pg);
    expect(out.ok).toBe(true);
    const salt = pg.tables._meta.find((r) => r.key === "usageIdentitySalt");
    expect(salt?.value).toBe("salt-from-sqlite");
    const ver = pg.tables._meta.find((r) => r.key === "schemaVersion");
    expect(ver?.value).toBe("19");
  });
});
