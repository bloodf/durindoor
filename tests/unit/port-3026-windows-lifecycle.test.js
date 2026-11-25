import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../../cli/${file}`, import.meta.url), "utf8");
const cliSource = read("cli.js");

function fakeChild() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 4000, exitCode: null, signalCode: null, stderr: new PassThrough(), stdout: new PassThrough(), stdin: new PassThrough() });
  child.unref = vi.fn();
  child.kill = vi.fn();
  return child;
}

function load(file, modules, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(read(file), {
    module, __dirname: path.resolve("cli"), console,
    require: (name) => modules[name] ?? require(name),
    ...globals,
  });
  return module.exports;
}

function startWorker(platform) {
  const events = new EventEmitter();
  Object.assign(events, { env: {}, platform, exit: vi.fn(), kill: vi.fn() });
  const spawn = vi.fn(fakeChild);
  vm.runInNewContext(cliSource.slice(cliSource.indexOf("const MAX_RESTARTS ="), cliSource.indexOf("function main(")) + ";startServer(null)", {
    headless: true, trayMode: false, showLog: false, host: "127.0.0.1", DEFAULT_HOST: "0.0.0.0", port: 20128,
    getDisplayHost: () => "127.0.0.1", console: { log: vi.fn(), error: vi.fn() }, process: events, spawn,
    RUNTIME: "/node", serverPath: "/app/custom-server.js", standaloneDir: "/app",
    buildNodeArgs: (serverPath) => [serverPath], buildEnvWithRuntime: (env) => env, setTimeout: vi.fn(),
  });
  return spawn;
}

describe("upstream #3026: Windows launcher lifecycle", () => {
  it.each([["win32", false], ["linux", true], ["darwin", true]])(
    "spawns the %s server worker with detached=%s",
    (platform, detached) => {
      expect(startWorker(platform).mock.calls[0][2]).toMatchObject({ detached, windowsHide: true });
    },
  );

  describe("PowerShell tray", () => {
    function trays() {
      const children = [];
      const timers = [];
      const { initWinTray } = load("src/cli/tray/trayWin.js", {
        child_process: { spawn: () => children[children.push(fakeChild()) - 1] },
      }, { setTimeout: (fn) => timers.push(fn) });
      const open = (callbacks = {}) => initWinTray({ iconPath: "i.ico", tooltip: "t", items: [], ...callbacks });
      return { children, timers, open };
    }

    it("never lets an old tray's delayed kill terminate its replacement", () => {
      const run = trays();
      run.open().kill();
      run.open();
      run.timers.forEach((fire) => fire());

      expect(run.children[0].kill).toHaveBeenCalledOnce();
      expect(run.children[1].kill).not.toHaveBeenCalled();
    });

    it("survives a broken stdin pipe and does not report an intentional quit as a failure", () => {
      const run = trays();
      const onError = vi.fn();
      const tray = run.open({ onError });

      expect(() => run.children[0].stdin.emit("error", new Error("EPIPE"))).not.toThrow();
      tray.kill();
      run.children[0].emit("exit", 0);

      expect(onError).not.toHaveBeenCalled();
    });

    it("still reports a tray that exits on its own", () => {
      const run = trays();
      const onError = vi.fn();
      run.open({ onError });
      run.children[0].emit("exit", 1);

      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe("hide-to-tray hand-off", () => {
    // The real hand-off block, from the spawn to the launcher's own exit.
    const start = cliSource.indexOf("          const bgProcess = spawn(");
    const block = cliSource.slice(start, cliSource.indexOf('        } else if (choice === "exit")', start));

    async function handOff(outcome) {
      const child = fakeChild();
      const exit = vi.fn();
      const log = { log: vi.fn(), error: vi.fn() };
      const done = vm.runInNewContext(`(async () => {${block}})()`, {
        spawn: () => {
          process.nextTick(() => child.emit(outcome, new Error("spawn ENOENT")));
          return child;
        },
        process: { execPath: "/node", env: {}, exit }, console: log, __filename: "cli.js",
        host: "127.0.0.1", port: 20128, displayHost: "127.0.0.1", DISPLAY_NAME: "DurinDoor",
      });
      await done;
      return { child, exit, log };
    }

    it("reports success only after the background launcher has spawned", async () => {
      const run = await handOff("spawn");
      expect(run.child.unref).toHaveBeenCalledOnce();
      expect(run.exit.mock.calls).toEqual([[0]]);
    });

    it("exits non-zero instead of claiming a tray that never started", async () => {
      const run = await handOff("error");
      expect(run.exit.mock.calls).toEqual([[1]]);
      expect(run.log.error).toHaveBeenCalledWith(expect.stringContaining("spawn ENOENT"));
      expect(run.log.log).not.toHaveBeenCalledWith(expect.stringContaining("running in background"));
    });
  });

  it("hides the console window of every clipboard command", () => {
    const execSync = vi.fn();
    const { copyToClipboard } = load("src/cli/utils/clipboard.js", { child_process: { execSync } }, { process: { platform: "win32" } });

    expect(copyToClipboard("text")).toBe(true);
    expect(execSync).toHaveBeenCalledWith("clip", expect.objectContaining({ windowsHide: true }));
  });

  it("hides the console window of the synchronous runtime npm install", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));
    const { runNpmInstall } = load("hooks/sqliteRuntime.js", { child_process: { spawnSync } }, { process: { platform: "win32", env: {} } });

    runNpmInstall({ cwd: "/runtime", pkgs: ["sql.js"] });
    expect(spawnSync.mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });
});
