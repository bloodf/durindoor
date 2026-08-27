import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlJsAdapter } from "@/lib/db/adapters/sqljsAdapter.js";

let dir;
let dbPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-sqljs-"));
  dbPath = path.join(dir, "data.sqlite");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function tempFiles() {
  return fs.readdirSync(dir).filter((name) => name !== path.basename(dbPath));
}

async function persistRow(value) {
  const adapter = await createSqlJsAdapter(dbPath);
  adapter.run("CREATE TABLE IF NOT EXISTS records(value TEXT)");
  adapter.run("INSERT INTO records(value) VALUES(?)", [value]);
  adapter.close();
}

describe("sql.js atomic persistence", () => {
  it("preserves the previous database and removes staging files when a later write fails", async () => {
    await persistRow("before");
    const before = fs.readFileSync(dbPath);
    const adapter = await createSqlJsAdapter(dbPath);
    adapter.run("INSERT INTO records(value) VALUES(?)", ["after"]);

    const realWrite = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((target, data, options) => {
      realWrite(target, Buffer.from(data).subarray(0, 32), options);
      throw new Error("simulated interrupted write");
    });

    expect(() => adapter.close()).toThrow("simulated interrupted write");
    expect(fs.readFileSync(dbPath)).toEqual(before);
    expect(tempFiles()).toEqual([]);
    adapter.raw.close();
  });

  it("writes an owner-only sibling file, fsyncs it, and renames it over the target", async () => {
    const adapter = await createSqlJsAdapter(dbPath);
    adapter.run("CREATE TABLE records(value TEXT)");

    const realOpen = fs.openSync;
    const opened = [];
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      opened.push({ target: String(target), flags, mode });
      return realOpen(target, flags, mode);
    });
    const fsync = vi.spyOn(fs, "fsyncSync");
    const rename = vi.spyOn(fs, "renameSync");

    adapter.close();

    const staged = opened.find(({ target }) => target !== dbPath);
    expect(staged).toMatchObject({ flags: "wx", mode: 0o600 });
    expect(path.dirname(staged.target)).toBe(dir);
    expect(fsync).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith(staged.target, dbPath);
    expect(tempFiles()).toEqual([]);
  });
});
