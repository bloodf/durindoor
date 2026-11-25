import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { releaseExclusiveLock } from "../../src/lib/db/exclusiveLockRelease.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-release-checkpoint-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// Records every statement the adapter sends through its driver handle.
function spy(adapter, method) {
  const calls = [];
  const original = adapter.raw[method].bind(adapter.raw);
  adapter.raw[method] = (sql, ...rest) => {
    calls.push(sql);
    return original(sql, ...rest);
  };
  return calls;
}

describe("port(omniroute) #21159 0e65d1eb19d6: releasing an exclusive lock runs no explicit checkpoint", () => {
  it.each([
    ["better-sqlite3", (file) => createBetterSqliteAdapter(file), "pragma", "wal_checkpoint(TRUNCATE)"],
    ["node:sqlite", (file) => createNodeSqliteAdapter(file), "exec", "PRAGMA wal_checkpoint(TRUNCATE)"],
  ])("%s skips it on release and keeps it on an ordinary close", async (_name, open, method, checkpoint) => {
    const released = await open(path.join(dir, "released.db"));
    const releaseCalls = spy(released, method);
    expect(releaseExclusiveLock(released)).toEqual({ kind: "CLOSED" });
    expect(releaseCalls).toEqual([]);

    const ordinary = await open(path.join(dir, "ordinary.db"));
    const closeCalls = spy(ordinary, method);
    ordinary.close();
    expect(ordinary.open).toBe(false);
    expect(closeCalls).toEqual([checkpoint]);
  });
});
