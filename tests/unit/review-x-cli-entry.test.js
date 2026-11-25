import childProcess from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../..", import.meta.url));

// Issue 2292: cli.js ran its whole launcher on require. The test loads a private
// copy with stub hooks and no app bundle, so even a launcher that does start on
// require cannot reach a real gateway, install a runtime or leave the temp dir.
let root;
let cli;
let loadError;
let spies;
let hookCalls;
let signalListeners;
let envBefore;
let envAfterRequire;
const savedEnv = {};
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException"];
const listenerCounts = () => SIGNALS.map((signal) => process.listenerCount(signal));

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-entry-"));
  for (const name of ["cli.js", "package.json", "src"]) {
    fs.cpSync(path.join(repo, "cli", name), path.join(root, name), { recursive: true });
  }
  for (const file of ["src/lib/startup/listenConfig.cjs", "src/lib/updater/dataDir.cjs"]) {
    fs.mkdirSync(path.dirname(path.join(root, "app", file)), { recursive: true });
    fs.copyFileSync(path.join(repo, file), path.join(root, "app", file));
  }
  const machineId = path.join(root, "node_modules", "node-machine-id");
  fs.mkdirSync(machineId, { recursive: true });
  fs.writeFileSync(path.join(machineId, "index.js"), 'exports.machineIdSync = () => "fixture";');
  fs.mkdirSync(path.join(root, "hooks"));
  const stubs = {
    sqliteRuntime: 'exports.ensureSqliteRuntime = () => globalThis.__cliEntryHooks.push("sqlite"); exports.buildEnvWithRuntime = (env) => env;',
    nodeFlags: "exports.buildNodeArgs = () => [];",
    killByPidFile: 'exports.killByPidFile = () => globalThis.__cliEntryHooks.push("kill");',
  };
  for (const [name, source] of Object.entries(stubs)) fs.writeFileSync(path.join(root, "hooks", `${name}.js`), source);

  for (const key of ["DATA_DIR", "PORT", "TRAY_MODE"]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATA_DIR = path.join(root, "data", "..", "data");
  hookCalls = globalThis.__cliEntryHooks = [];
  const never = () => { throw new Error("require must not start anything"); };
  spies = {
    exit: vi.spyOn(process, "exit").mockImplementation(never),
    kill: vi.spyOn(process, "kill").mockImplementation(never),
    spawn: vi.spyOn(childProcess, "spawn").mockImplementation(never),
    exec: vi.spyOn(childProcess, "exec").mockImplementation(never),
    execSync: vi.spyOn(childProcess, "execSync").mockImplementation(never),
    listen: vi.spyOn(net.Server.prototype, "listen").mockImplementation(never),
    update: vi.spyOn(https, "get").mockImplementation(never),
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
  signalListeners = listenerCounts();
  envBefore = { ...process.env };
  try {
    cli = require(path.join(root, "cli.js"));
  } catch (error) {
    loadError = error;
  }
  envAfterRequire = { ...process.env };
});

afterAll(() => {
  vi.restoreAllMocks();
  delete globalThis.__cliEntryHooks;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("cli.js entry point (issue 2292)", () => {
  it("starts nothing when required", () => {
    expect(loadError).toBeUndefined();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(hookCalls).toEqual([]);
    expect(listenerCounts()).toEqual(signalListeners);
    expect(envAfterRequire).toEqual(envBefore);
    expect(fs.existsSync(path.join(root, "data"))).toBe(false);
  });

  it("exports main and the pure helpers", () => {
    for (const name of ["main", "parseArgs", "hasFlag", "compareVersions"]) {
      expect(cli?.[name], name).toBeInstanceOf(Function);
    }
  });

  const defaults = {
    port: 20128, host: "0.0.0.0", noBrowser: false, skipUpdate: false,
    showLog: false, trayMode: false, headless: false,
  };

  it.each([
    [[], {}],
    [["--port", "3000"], { port: 3000 }],
    [["-p", "3001"], { port: 3001 }],
    [["--host", "127.0.0.1"], { host: "127.0.0.1" }],
    [["-H", "localhost"], { host: "localhost" }],
    [["--tray"], { trayMode: true }],
    [["-t", "-p", "3002", "-H", "::1"], { trayMode: true, port: 3002, host: "::1" }],
    [["--skip-update"], { skipUpdate: true }],
    [["--tray", "--headless"], { headless: true, noBrowser: true }],
    [["-n", "-l"], { noBrowser: true, showLog: true }],
  ])("parses %j without touching the environment", (args, expected) => {
    const env = {};
    expect(cli.parseArgs(args, { env, isTTY: true })).toEqual({ ...defaults, ...expected });
    expect(env).toEqual({});
  });

  it("keeps the environment port and the detached updater tray fallback", () => {
    expect(cli.parseArgs([], { env: { PORT: "23456" }, isTTY: true }).port).toBe(23456);
    expect(cli.parseArgs(["--skip-update"], { env: {}, isTTY: false }).trayMode).toBe(true);
    expect(() => cli.parseArgs([], { env: { PORT: "0" }, isTTY: true })).toThrow("Invalid server port");
  });

  it("does not read a flag value as a flag", () => {
    expect(cli.hasFlag(["--host", "-h"], "--help", "-h")).toBe(false);
    expect(cli.hasFlag(["--tray", "-h"], "--help", "-h")).toBe(true);
  });

  it("runs the launcher only through main(argv)", () => {
    spies.exit.mockImplementation((code) => { throw { exit: code }; });
    expect(() => cli.main(["--version"])).toThrow(expect.objectContaining({ exit: 0 }));
    expect(spies.log).toHaveBeenCalledWith(require(path.join(root, "package.json")).version);
    expect(process.env.DATA_DIR).toBe(path.join(root, "data"));
    expect(hookCalls).toEqual([]);

    // Without an app bundle, a real start stops at the owner-aware server check.
    expect(() => cli.main(["--tray", "--port", "3003"])).toThrow(expect.objectContaining({ exit: 1 }));
    expect(spies.error).toHaveBeenLastCalledWith(expect.stringContaining("owner-aware custom-server.js is missing"));
    expect(hookCalls).toEqual(["sqlite"]);
    expect(process.env.TRAY_MODE).toBe("1");
    expect(spies.spawn).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
  });
});
