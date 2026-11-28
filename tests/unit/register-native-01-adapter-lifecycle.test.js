// Teardown order for the media registration fixture, against the real sql.js
// adapter. The driver normally picks better-sqlite3 or node:sqlite, so this file
// builds the sql.js adapter directly and hands the helper a driver-shaped state.
// It does not run the driver or register-native-01's hooks.
//
// Every dirty case runs from the write to the close without yielding to a timer,
// so the adapter's 100 ms debounced save cannot flush first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";
import { closeAdapterWithin } from "./helpers/closeAdapterWithin.js";

// Importing the adapter creates DATA_DIR (or ~/.9router), so claim a private
// directory before any import runs.
const isolated = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const had = Object.hasOwn(process.env, "DATA_DIR");
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-01-lifecycle-data-"));
  process.env.DATA_DIR = dir;
  return { dir, had, previous };
});
afterAll(() => {
  if (isolated.had) process.env.DATA_DIR = isolated.previous;
  else delete process.env.DATA_DIR;
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

let root;
let opened;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-01-lifecycle-"));
  opened = [];
});
afterEach(() => {
  // Recreate removed directories so a still-dirty handle can flush and close.
  for (const { adapter, dir } of opened) {
    fs.mkdirSync(dir, { recursive: true });
    if (isOpen(adapter)) adapter.close();
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function isOpen(adapter) {
  try {
    adapter.get("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function openIn(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "data.sqlite");
  const adapter = await createSqlJsAdapter(file);
  opened.push({ adapter, dir });
  return { dir, file, adapter, state: { instance: adapter, initPromise: Promise.resolve(adapter), file, cacheKey: `sqlite:${file}` } };
}

function dirty(adapter) {
  adapter.exec("CREATE TABLE t (v TEXT)");
  adapter.run("INSERT INTO t VALUES (?)", ["unsaved"]);
}

async function savedRows(file) {
  const reader = await createSqlJsAdapter(file);
  const rows = reader.all("SELECT v FROM t");
  reader.close();
  return rows;
}

const RESET = { instance: null, initPromise: null, file: null, cacheKey: null };

describe("sql.js dirty close ordering", () => {
  it("cannot close a dirty handle once its directory is gone, and leaves it open", async () => {
    const { dir, adapter } = await openIn("case");
    dirty(adapter);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(() => adapter.close()).toThrow(/ENOENT/);
    expect(adapter.all("SELECT v FROM t")).toEqual([{ v: "unsaved" }]);
  });

  it("flushes and closes an owned handle while its directory exists", async () => {
    const { dir, file, adapter, state } = await openIn("case");
    dirty(adapter);
    await closeAdapterWithin(state, dir);
    expect(state).toEqual(RESET);
    expect(isOpen(adapter)).toBe(false);
    expect(await savedRows(file)).toEqual([{ v: "unsaved" }]);
  });

  it("rejects a failed close and keeps the handle for a retry", async () => {
    const { dir, file, adapter, state } = await openIn("case");
    dirty(adapter);
    const before = { ...state };
    fs.rmSync(dir, { recursive: true, force: true });
    await expect(closeAdapterWithin(state, dir)).rejects.toThrow(/ENOENT/);
    expect(state).toEqual(before);
    expect(isOpen(adapter)).toBe(true);
    fs.mkdirSync(dir);
    await closeAdapterWithin(state, dir);
    expect(state).toEqual(RESET);
    expect(await savedRows(file)).toEqual([{ v: "unsaved" }]);
  });

  it.each(["other", "case-sibling"])("leaves a handle in %s untouched when cleaning case", async (name) => {
    const { file, adapter, state } = await openIn(name);
    dirty(adapter);
    const before = { ...state };
    await closeAdapterWithin(state, path.join(root, "case"));
    expect(state).toEqual(before);
    expect(isOpen(adapter)).toBe(true);
    // Still unsaved: the helper neither closed nor flushed it.
    expect(fs.existsSync(file)).toBe(false);
  });

  it("waits for an open in flight, then closes the handle it publishes", async () => {
    const { dir, adapter } = await openIn("case");
    const state = { ...RESET };
    state.initPromise = Promise.resolve().then(() => {
      Object.assign(state, { instance: adapter, file: path.join(dir, "data.sqlite") });
      return adapter;
    });
    await closeAdapterWithin(state, dir);
    expect(state).toEqual(RESET);
    expect(isOpen(adapter)).toBe(false);
  });
});
