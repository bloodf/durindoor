import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ adapter: null }));
vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => state.adapter }));
import { addDiscoveredModelAliases } from "../../src/lib/db/repos/aliasRepo.js";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE kv (scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope, key))");
  state.adapter = {
    all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => db.prepare(sql).run(...params),
    transaction: (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try { fn(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  return db;
}

describe("upstream model selection", () => {
  let db;
  beforeEach(() => { db = setup(); });

  it("preserves existing aliases, deduplicates discoveries and makes retries safe", async () => {
    db.prepare("INSERT INTO kv VALUES (?, ?, ?)").run("modelAliases", "model", JSON.stringify("other/model"));
    db.prepare("INSERT INTO kv VALUES (?, ?, ?)").run("modelAliases", "saved", JSON.stringify("p/already"));
    expect(await addDiscoveredModelAliases("p", ["vendor/model", "vendor/model", "already"], true)).toEqual([{ id: "vendor/model", alias: "p-model" }]);
    expect(await addDiscoveredModelAliases("p", ["vendor/model", "already"], true)).toEqual([]);
    expect(db.prepare("SELECT key, value FROM kv ORDER BY key").all().map(({ key, value }) => [key, JSON.parse(value)])).toEqual([
      ["model", "other/model"], ["p-model", "p/vendor/model"], ["saved", "p/already"],
    ]);
  });

  it("reads current aliases for each operation and does not overwrite concurrent edits", async () => {
    await addDiscoveredModelAliases("p", ["a"]);
    db.prepare("INSERT INTO kv VALUES (?, ?, ?)").run("modelAliases", "b", JSON.stringify("other/b"));
    expect(await addDiscoveredModelAliases("p", ["b"])).toEqual([{ id: "b", alias: "p-b" }]);
    expect(JSON.parse(db.prepare("SELECT value FROM kv WHERE key = 'b'").get().value)).toBe("other/b");
  });

  it("rolls back every alias when a write fails and permits a retry", async () => {
    db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON kv WHEN NEW.key = 'b' BEGIN SELECT RAISE(ABORT, 'failed'); END");
    await expect(addDiscoveredModelAliases("p", ["a", "b"])).rejects.toThrow("failed");
    expect(db.prepare("SELECT count(*) AS count FROM kv").get().count).toBe(0);
    db.exec("DROP TRIGGER fail_second");
    expect(await addDiscoveredModelAliases("p", ["a", "b"])).toHaveLength(2);
  });
});

describe("discovered models endpoint", () => {
  beforeEach(() => { setup(); });
  it("rejects malformed selections and persists valid selections", async () => {
    const { POST } = await import("../../src/app/api/models/discovered/route.js");
    const request = (body) => new Request("http://localhost/api/models/discovered", { method: "POST", body: JSON.stringify(body) });
    expect((await POST(request({ providerAlias: "../bad", ids: ["a"] }))).status).toBe(400);
    expect((await POST(request({ providerAlias: "p", ids: [""] }))).status).toBe(400);
    const response = await POST(request({ providerAlias: "p", ids: ["a", "a"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: [{ id: "a", alias: "a" }] });
  });
});
