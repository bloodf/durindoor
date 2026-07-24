import { describe, expect, it, afterEach } from "vitest";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";

// Regression test for upstream 9router #2530 (issue #2529): params must be
// spread into the statement call, not passed as one array.
describe("betterSqliteAdapter parameter binding", () => {
  let adapter;

  afterEach(() => {
    adapter?.close();
    adapter = undefined;
  });

  function freshAdapter() {
    adapter = createBetterSqliteAdapter(":memory:");
    adapter.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, n INTEGER)");
    return adapter;
  }

  it("binds a single named-parameter object carried in the params array", () => {
    const db = freshAdapter();
    db.run("INSERT INTO kv (k, v) VALUES ($key, $value)", [{ key: "greeting", value: "hello" }]);
    const row = db.get("SELECT v FROM kv WHERE k = $key", [{ key: "greeting" }]);
    expect(row).toEqual({ v: "hello" });
  });

  it("binds multiple positional parameters for run/get/all", () => {
    const db = freshAdapter();
    db.run("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)", ["a", "first", 1]);
    db.run("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)", ["b", "second", 2]);

    expect(db.get("SELECT v FROM kv WHERE k = ? AND n = ?", ["b", 2])).toEqual({ v: "second" });
    expect(db.all("SELECT k FROM kv WHERE n > ? ORDER BY n DESC", [0])).toEqual([{ k: "b" }, { k: "a" }]);
  });
});
