import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";
import { releaseExclusiveLock } from "../../src/lib/db/exclusiveLockRelease.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

let dir;
let file;
const opened = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "exclusive-lock-release-"));
  file = path.join(dir, "lock.db");
});
afterEach(() => {
  for (const a of opened.splice(0)) {
    try { a.close(); } catch { /* already closed */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function track(adapter) {
  opened.push(adapter);
  return adapter;
}

// A holder that writes under locking_mode=EXCLUSIVE keeps the lock after commit.
function holdExclusive(adapter) {
  adapter.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)");
  adapter.exec("PRAGMA locking_mode = EXCLUSIVE");
  adapter.run("INSERT INTO t (v) VALUES ('held')");
}

function secondConnectionRead() {
  const reader = new Database(file, { timeout: 0 });
  try {
    return { n: reader.prepare("SELECT count(*) AS n FROM t").get().n };
  } catch (error) {
    return { error: String(error) };
  } finally {
    reader.close();
  }
}

function stub(overrides) {
  return { open: true, inTransaction: false, close: () => {}, ...overrides };
}

describe("releaseExclusiveLock with real SQLite handles", () => {
  it("anchor: a holder that wrote under exclusive locking blocks a second connection", () => {
    const adapter = track(createBetterSqliteAdapter(file));
    holdExclusive(adapter);
    expect(secondConnectionRead().error).toMatch(/busy|locked/i);
  });

  it("better-sqlite3: closing the holder lets a second connection read", () => {
    const adapter = track(createBetterSqliteAdapter(file));
    holdExclusive(adapter);
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
    expect(adapter.open).toBe(false);
    expect(secondConnectionRead()).toEqual({ n: 1 });
    // A separate process sees the same state: not an artifact of this connection.
    const child = spawnSync(
      process.execPath,
      ["-e", `const D=require("better-sqlite3");const d=new D(${JSON.stringify(file)},{timeout:0});console.log(d.prepare("SELECT count(*) n FROM t").get().n);d.close()`],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe("1");
  });

  it("better-sqlite3: an open transaction is refused and left alone", () => {
    const adapter = track(createBetterSqliteAdapter(file));
    adapter.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    adapter.exec("BEGIN IMMEDIATE");
    adapter.run("INSERT INTO t (v) VALUES ('pending')");
    expect(adapter.inTransaction).toBe(true);
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "REFUSED_OPEN_TRANSACTION" });
    expect(adapter.open).toBe(true);
    adapter.exec("COMMIT");
    expect(adapter.all("SELECT count(*) AS n FROM t")[0].n).toBe(1);
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
  });

  it("better-sqlite3: a live cursor makes the close fail, ending it allows the retry", () => {
    const adapter = track(createBetterSqliteAdapter(file));
    holdExclusive(adapter);
    const cursor = adapter.raw.prepare("SELECT v FROM t").iterate();
    cursor.next();
    const refused = releaseExclusiveLock(adapter);
    // The adapter swallows the driver refusal, so the observed open flag decides.
    expect(refused.kind).toBe("REFUSED_STILL_OPEN");
    expect(refused.reason).toBe("OPEN_STILL_TRUE");
    expect(adapter.open).toBe(true);
    cursor.return();
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
    expect(adapter.open).toBe(false);
  });

  it("better-sqlite3: release sets no pragma", () => {
    const adapter = track(createBetterSqliteAdapter(file));
    holdExclusive(adapter);
    const seen = [];
    const original = adapter.raw.pragma.bind(adapter.raw);
    adapter.raw.pragma = (sql, ...rest) => {
      seen.push(sql);
      return original(sql, ...rest);
    };
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
    // Only the adapter's own pre-close checkpoint; no locking_mode or other setting.
    expect(seen.filter((s) => !/^wal_checkpoint/.test(s))).toEqual([]);
  });

  it("node:sqlite: reports driver state and refuses an open transaction", async () => {
    const adapter = track(await createNodeSqliteAdapter(file));
    expect(adapter.inTransaction).toBe(false);
    adapter.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    adapter.exec("BEGIN");
    expect(adapter.inTransaction).toBe(true);
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "REFUSED_OPEN_TRANSACTION" });
    expect(adapter.open).toBe(true);
    adapter.exec("COMMIT");
    expect(adapter.inTransaction).toBe(false);
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
    expect(adapter.open).toBe(false);
    expect(adapter.inTransaction).toBe(false);
  });

  it("node:sqlite: closing an exclusive-mode holder leaves the data readable", async () => {
    // Unlike better-sqlite3, the bundled node:sqlite does not block the second
    // connection while it holds exclusive mode here, so only the post-release
    // read is asserted for this driver.
    const adapter = track(await createNodeSqliteAdapter(file));
    holdExclusive(adapter);
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
    expect(adapter.open).toBe(false);
    expect(secondConnectionRead()).toEqual({ n: 1 });
  });

  it("node:sqlite: a live statement iterator keeps the handle open and is reported", async () => {
    const adapter = track(await createNodeSqliteAdapter(file));
    holdExclusive(adapter);
    const iterator = adapter.raw.prepare("SELECT v FROM t").iterate();
    iterator.next();
    const outcome = releaseExclusiveLock(adapter);
    if (outcome.kind === "CLOSED") {
      // Some node:sqlite versions finalize statements on close; the state still agrees.
      expect(adapter.open).toBe(false);
    } else {
      expect(outcome).toEqual({ kind: "REFUSED_STILL_OPEN", reason: "OPEN_STILL_TRUE" });
      expect(adapter.open).toBe(true);
    }
  });

  it("sql.js has no transaction state, so release is refused without closing", async () => {
    const adapter = track(await createSqlJsAdapter(file));
    let closes = 0;
    const original = adapter.close;
    adapter.close = () => { closes += 1; return original(); };
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "REFUSED_UNKNOWN_TRANSACTION" });
    expect(closes).toBe(0);
    adapter.close = original;
  });
});

describe("releaseExclusiveLock outcome mapping", () => {
  it("treats missing or non-boolean transaction state as unknown and does not close", () => {
    for (const inTransaction of [undefined, null, "no", 0]) {
      let closes = 0;
      const adapter = stub({ inTransaction, close: () => { closes += 1; } });
      expect(releaseExclusiveLock(adapter)).toEqual({ kind: "REFUSED_UNKNOWN_TRANSACTION" });
      expect(closes).toBe(0);
    }
  });

  it("treats a throwing transaction getter as unknown and does not close", () => {
    let closes = 0;
    const adapter = stub({ close: () => { closes += 1; } });
    Object.defineProperty(adapter, "inTransaction", { get() { throw new Error("unavailable"); } });
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "REFUSED_UNKNOWN_TRANSACTION" });
    expect(closes).toBe(0);
  });

  it("reports CLOSE_THREW with the message when the close throws and the handle stays open", () => {
    const adapter = stub({ close: () => { throw new Error("database is busy"); } });
    expect(releaseExclusiveLock(adapter)).toEqual({
      kind: "REFUSED_STILL_OPEN",
      reason: "CLOSE_THREW",
      message: "database is busy",
    });
  });

  it("reports a close that took effect and then threw as CLOSED", () => {
    let closed = false;
    const adapter = stub({
      close: () => { closed = true; throw new Error("failure after release"); },
    });
    Object.defineProperty(adapter, "open", { get: () => !closed });
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "CLOSED" });
  });

  it("reports a close that returns without closing as OPEN_STILL_TRUE", () => {
    expect(releaseExclusiveLock(stub())).toEqual({ kind: "REFUSED_STILL_OPEN", reason: "OPEN_STILL_TRUE" });
  });

  it("does not call an unreadable witness open or closed", () => {
    let done = false;
    const adapter = stub({ close: () => { done = true; } });
    Object.defineProperty(adapter, "open", {
      get() { if (done) throw new Error("read failed"); return true; },
    });
    expect(releaseExclusiveLock(adapter)).toEqual({ kind: "REFUSED_STILL_OPEN", reason: "OPEN_WITNESS_UNREADABLE" });
    for (const open of [undefined, "false", 0]) {
      expect(releaseExclusiveLock(stub({ open }))).toEqual({
        kind: "REFUSED_STILL_OPEN",
        reason: "OPEN_WITNESS_UNREADABLE",
      });
    }
  });

  it("keeps the close message when the witness is also unreadable", () => {
    const adapter = stub({ close: () => { throw new Error("boom"); } });
    Object.defineProperty(adapter, "open", { get() { throw new Error("nope"); } });
    expect(releaseExclusiveLock(adapter)).toEqual({
      kind: "REFUSED_STILL_OPEN",
      reason: "OPEN_WITNESS_UNREADABLE",
      message: "boom",
    });
  });
});
