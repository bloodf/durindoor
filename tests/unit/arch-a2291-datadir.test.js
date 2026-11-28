/**
 * Refs #2291: the app server, detached updater, CLI launcher and MITM process
 * share one DATA_DIR resolver (src/lib/updater/dataDir.cjs). These cases pin
 * the shared precedence/fallback contract and that each consumer keeps its own
 * directory policy. Every filesystem case uses a disposable temp directory and
 * runs module-level resolvers in child processes with a private HOME.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { resolveDataDirWith, defaultDataDir } = require("../../src/lib/updater/dataDir.cjs");

const posix = process.platform === "win32" ? describe.skip : describe;
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

function errno(code) {
  return Object.assign(new Error(code), { code });
}

describe("defaultDataDir", () => {
  it("uses ~/.9router on POSIX", () => {
    expect(defaultDataDir({ platform: "linux", env: {}, homedir: () => "/fixture/home" }))
      .toBe("/fixture/home/.9router");
  });

  it("prefers APPDATA on Windows and falls back to the roaming profile", () => {
    const homedir = () => "C:\\Users\\fixture";
    expect(defaultDataDir({ platform: "win32", env: { APPDATA: "D:\\Data" }, homedir }))
      .toBe("D:\\Data\\9router");
    expect(defaultDataDir({ platform: "win32", env: {}, homedir }))
      .toBe("C:\\Users\\fixture\\AppData\\Roaming\\9router");
  });
});

describe("resolveDataDirWith contract", () => {
  const base = { platform: "linux", homedir: () => "/fixture/home", cwd: () => "/fixture/cwd" };

  it("resolves a configured DATA_DIR against cwd and applies ensureDir", () => {
    const ensureDir = vi.fn();
    const ensureDefault = vi.fn();
    expect(resolveDataDirWith({ ...base, env: { DATA_DIR: "rel/data" }, ensureDir, ensureDefault }))
      .toBe("/fixture/cwd/rel/data");
    expect(ensureDir).toHaveBeenCalledWith("/fixture/cwd/rel/data");
    expect(ensureDefault).not.toHaveBeenCalled();
  });

  it("uses the default without DATA_DIR and treats ensureDefault as best-effort", () => {
    const ensureDir = vi.fn();
    const ensureDefault = vi.fn(() => { throw errno("EACCES"); });
    expect(resolveDataDirWith({ ...base, env: {}, ensureDir, ensureDefault })).toBe("/fixture/home/.9router");
    expect(ensureDefault).toHaveBeenCalledWith("/fixture/home/.9router");
    expect(ensureDir).not.toHaveBeenCalled();
    // Without ensureDefault the default is returned untouched.
    expect(resolveDataDirWith({ ...base, env: {}, ensureDir })).toBe("/fixture/home/.9router");
  });

  it.each(["EACCES", "EPERM"])("falls back to the default on %s with one warning", (code) => {
    const warn = vi.fn();
    const ensureDir = vi.fn(() => { throw errno(code); });
    expect(resolveDataDirWith({ ...base, env: { DATA_DIR: "/locked" }, ensureDir, warn }))
      .toBe("/fixture/home/.9router");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("not writable");
  });

  it("rethrows other errors", () => {
    const ensureDir = vi.fn(() => { throw errno("ENOSPC"); });
    expect(() => resolveDataDirWith({ ...base, env: { DATA_DIR: "/full" }, ensureDir, warn: vi.fn() }))
      .toThrow("ENOSPC");
  });

  it("ignores a Unix path on Windows without creating it", () => {
    const ensureDir = vi.fn();
    const warn = vi.fn();
    expect(resolveDataDirWith({
      platform: "win32", homedir: () => "C:\\Users\\fixture", cwd: () => "C:\\work",
      env: { DATA_DIR: "/var/lib/9router", APPDATA: "D:\\Data" }, ensureDir, warn,
    })).toBe("D:\\Data\\9router");
    expect(ensureDir).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("never falls back in hosted mode", () => {
    const isHosted = () => true;
    const ensureDir = vi.fn(() => { throw errno("EACCES"); });
    expect(() => resolveDataDirWith({ ...base, env: {}, ensureDir, isHosted }))
      .toThrow("DATA_DIR is required in hosted mode");
    expect(() => resolveDataDirWith({ ...base, env: { DATA_DIR: "/locked" }, ensureDir, isHosted }))
      .toThrow("EACCES");
    expect(() => resolveDataDirWith({
      platform: "win32", homedir: () => "C:\\Users\\fixture", cwd: () => "C:\\work",
      env: { DATA_DIR: "/var/lib/9router" }, ensureDir, isHosted,
    })).toThrow("Invalid DATA_DIR for Windows in hosted mode");
  });
});

posix("consumers share resolution but keep their own directory policy", () => {
  let root;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-datadir-shared-")));
    fs.mkdirSync(path.join(root, "home"));
    fs.mkdirSync(path.join(root, "cwd"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.chmodSync(root, 0o700);
    for (const entry of fs.readdirSync(root)) {
      try { fs.chmodSync(path.join(root, entry), 0o700); } catch { /* best effort */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Each consumer resolves DATA_DIR once at load; run it in a fresh process
  // whose HOME, cwd and DATA_DIR all point into the disposable root.
  function resolveIn(consumer, dataDir) {
    const scripts = {
      app: `const {resolveDataDir}=require(${JSON.stringify(path.join(repoRoot, "src/lib/updater/dataDir.cjs"))});`
        + "process.stdout.write(resolveDataDir(()=>false));",
      cli: `const {getAppDataDir}=require(${JSON.stringify(path.join(repoRoot, "cli/src/cli/appDataDir.js"))});`
        + "process.stdout.write(getAppDataDir());",
      mitm: `process.stdout.write(require(${JSON.stringify(path.join(repoRoot, "src/mitm/paths.js"))}).DATA_DIR);`,
    };
    const env = { PATH: process.env.PATH, HOME: path.join(root, "home") };
    if (dataDir !== undefined) env.DATA_DIR = dataDir;
    const result = spawnSync(process.execPath, ["-e", scripts[consumer]], {
      cwd: path.join(root, "cwd"), env, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    return { dir: result.stdout, stderr: result.stderr };
  }

  const modeOf = (dir) => fs.statSync(dir).mode & 0o777;

  it("resolves the same relative DATA_DIR in app, CLI and MITM", () => {
    const expected = path.join(root, "cwd", "relative-data");
    for (const consumer of ["app", "cli", "mitm"]) {
      expect(resolveIn(consumer, "relative-data").dir).toBe(expected);
    }
  });

  it("creates owner-only directories for app and CLI but leaves MITM modes alone", () => {
    for (const consumer of ["app", "cli", "mitm"]) {
      const dir = path.join(root, `existing-${consumer}`);
      fs.mkdirSync(dir);
      fs.chmodSync(dir, 0o755);
      resolveIn(consumer, dir);
      expect(modeOf(dir), consumer).toBe(consumer === "mitm" ? 0o755 : 0o700);
    }
  });

  it("only app and CLI create the default directory", () => {
    const fallback = path.join(root, "home", ".9router");
    expect(resolveIn("mitm").dir).toBe(fallback);
    expect(fs.existsSync(fallback)).toBe(false);
    for (const consumer of ["app", "cli"]) {
      expect(resolveIn(consumer).dir).toBe(fallback);
      expect(modeOf(fallback)).toBe(0o700);
      fs.rmSync(fallback, { recursive: true });
    }
  });

  it.skipIf(isRoot)("app, CLI and MITM fall back to the same default for an unwritable DATA_DIR", () => {
    const locked = path.join(root, "locked");
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o500);
    const target = path.join(locked, "data");
    const fallback = path.join(root, "home", ".9router");
    for (const consumer of ["app", "cli", "mitm"]) {
      const { dir, stderr } = resolveIn(consumer, target);
      expect(dir, consumer).toBe(fallback);
      expect(stderr).toContain("not writable");
    }
  });

  it("mitmAliasCache writes under the shared default when DATA_DIR is unset", async () => {
    vi.stubEnv("DATA_DIR", "");
    vi.stubEnv("HOME", path.join(root, "home"));
    vi.resetModules();
    const { writeAliasForTool } = await import("../../src/lib/mitmAliasCache.js");
    writeAliasForTool("fixture-tool", { a: "b" });
    const file = path.join(root, "home", ".9router", "mitm", "aliases.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ "fixture-tool": { a: "b" } });
  });
});
