import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getAppDataDir } = require("../../cli/src/cli/appDataDir.js");
const { resolveDataDir } = require("../../src/lib/updater/dataDir.cjs");
const posix = process.platform === "win32" ? describe.skip : describe;

posix("shared data directory permission policy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "datadir-policy-"));
  const original = process.env.DATA_DIR;
  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = original;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(["cli", "server"])("creates and repairs directories through %s", (entry) => {
    const dir = path.join(root, entry);
    const run = () => entry === "cli"
      ? getAppDataDir({ env: { DATA_DIR: dir } })
      : (process.env.DATA_DIR = dir, resolveDataDir(() => false));
    run();
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    fs.chmodSync(dir, 0o755);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    run();
    run();
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(warn).toHaveBeenCalledTimes(1);
    fs.chmodSync(dir, 0o500);
    run();
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.each(["cli", "server"])("leaves a foreign-owned directory alone through %s", (entry) => {
    const dir = path.join(root, entry);
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    const realStat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((target, ...args) => {
      const result = realStat(target, ...args);
      if (target === dir) result.uid = process.getuid() + 1;
      return result;
    });
    const chmod = vi.spyOn(fs, "chmodSync");
    if (entry === "cli") getAppDataDir({ env: { DATA_DIR: dir } });
    else { process.env.DATA_DIR = dir; resolveDataDir(() => false); }
    expect(chmod).not.toHaveBeenCalled();
    expect(realStat(dir).mode & 0o777).toBe(0o755);
  });
});
