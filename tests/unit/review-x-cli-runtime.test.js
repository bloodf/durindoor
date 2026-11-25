import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const postinstall = fs.readFileSync(new URL("../../cli/hooks/postinstall.js", import.meta.url), "utf8");
const tray = fs.readFileSync(new URL("../../cli/hooks/trayRuntime.js", import.meta.url), "utf8");
const sqlite = fs.readFileSync(new URL("../../cli/hooks/sqliteRuntime.js", import.meta.url), "utf8");
const launcher = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

describe("CLI runtime installation", () => {
  it("only checks runtime dependencies at postinstall", () => {
    const ensureSqliteRuntime = vi.fn();
    const ensureTrayRuntime = vi.fn();
    vm.runInNewContext(postinstall.replace(/^#![^\n]*\n/, ""), {
      require: () => ({ ensureSqliteRuntime, ensureTrayRuntime }), console, process: { exit: vi.fn() },
    });
    expect(ensureSqliteRuntime).toHaveBeenCalledWith(expect.objectContaining({ allowInstall: false }));
    expect(ensureTrayRuntime).toHaveBeenCalledWith(expect.objectContaining({ allowInstall: false }));
  });

  it("installs better-sqlite3 asynchronously and remembers a failed version", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-sqlite-background-"));
    try {
      const child = new EventEmitter();
      const spawn = vi.fn(() => child);
      const spawnSync = vi.fn();
      const hookModule = { exports: {} };
      vm.runInNewContext(sqlite, {
        module: hookModule, process: { platform: "linux", env: { DATA_DIR: root } },
        require: (name) => ({ fs, os, path, child_process: { spawn, spawnSync } })[name],
      });
      const pending = hookModule.exports.installBetterSqliteInBackground();
      expect(spawn).toHaveBeenCalledWith("npm", expect.arrayContaining(["better-sqlite3@12.11.1", "--save-exact"]),
        expect.objectContaining({ cwd: path.join(root, "runtime") }));
      expect(spawnSync).not.toHaveBeenCalled();
      child.emit("close", 1);
      expect(await pending).toBe(false);
      expect(await hookModule.exports.installBetterSqliteInBackground()).toBe(false);
      expect(spawn).toHaveBeenCalledOnce();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // Run the production startServer with only its external effects mocked.
  function launch({ headless = false, trayMode = false } = {}) {
    const installAccelerator = vi.fn();
    let finishTray;
    const trayInstall = new Promise((resolve) => { finishTray = resolve; });
    const processMock = new EventEmitter();
    processMock.env = {};
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    vm.runInNewContext(launcher.slice(launcher.indexOf("const MAX_RESTARTS ="), launcher.indexOf("function main(")) + ";startServer(null, installAccelerator)", {
      installAccelerator, headless, trayMode, showLog: false, host: "127.0.0.1", DEFAULT_HOST: "0.0.0.0", port: 20128,
      RUNTIME: "/node", serverPath: "/app/custom-server.js", standaloneDir: "/app",
      getDisplayHost: () => "127.0.0.1", console: { log: vi.fn(), error: vi.fn() }, process: processMock,
      spawn: () => child, buildNodeArgs: () => [], buildEnvWithRuntime: (env) => env, DISPLAY_NAME: "DurinDoor",
      pkg: { version: "0" }, crypto: { randomBytes: () => Buffer.alloc(24) }, setTimeout: vi.fn(),
      waitServerReady: () => Promise.resolve(true), showInterfaceMenu: () => new Promise(() => {}),
      require: (name) => name === "./hooks/trayRuntime" ? { ensureTrayRuntime: () => trayInstall } : { initTray: vi.fn() },
    });
    return { installAccelerator, finishTray };
  }

  it.each([["tray", { trayMode: true }], ["menu", {}]])("installs the accelerator only after the %s mode tray install", async (_mode, options) => {
    const { installAccelerator, finishTray } = launch(options);
    await new Promise((resolve) => setImmediate(resolve));
    expect(installAccelerator).not.toHaveBeenCalled();
    finishTray({ systray: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(installAccelerator).toHaveBeenCalledOnce();
  });

  it("installs the accelerator after a headless server is ready", async () => {
    const { installAccelerator } = launch({ headless: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(installAccelerator).toHaveBeenCalledOnce();
  });

  it("wires the background installer into the launcher", () => {
    expect(launcher).toContain('startServer(updatePromise, () => require("./hooks/sqliteRuntime").installBetterSqliteInBackground()');
  });

  it("installs the tray asynchronously and remembers failures for this version", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-tray-test-"));
    try {
      const child = new EventEmitter();
      const spawn = vi.fn(() => child);
      const spawnSync = vi.fn();
      const hookModule = { exports: {} };
      vm.runInNewContext(tray, {
        module: hookModule, process: { platform: "linux" }, console: { log: vi.fn() },
        require: (name) => {
          if (name === "fs") return fs;
          if (name === "path") return path;
          if (name === "child_process") return { spawn, spawnSync };
          if (name === "./sqliteRuntime") return { getRuntimeDir: () => root, getRuntimeNodeModules: () => path.join(root, "node_modules") };
          throw new Error("missing module");
        },
      });
      const pending = hookModule.exports.ensureTrayRuntime({ asynchronous: true });
      expect(spawn).toHaveBeenCalledOnce();
      expect(spawnSync).not.toHaveBeenCalled();
      child.emit("close", 1);
      expect((await pending).systray).toBe(false);
      expect((await hookModule.exports.ensureTrayRuntime({ asynchronous: true })).systray).toBe(false);
      expect(spawn).toHaveBeenCalledOnce();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
