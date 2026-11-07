import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
const hookSource = fs.readFileSync(new URL("../../cli/hooks/trayRuntime.js", import.meta.url), "utf8");

function startup(args, isTTY = false, env = {}) {
  const tray = vi.fn();
  const sqlite = vi.fn();
  const context = {
    process: { argv: ["node", "cli.js", ...args], env, stdin: { isTTY }, exit: (code) => { throw { exit: code }; } },
    console: { log: vi.fn() },
    require: (name) => {
      if (name === "./package.json") return { name: "durindoor", version: "4.11.0" };
      if (name === "./hooks/sqliteRuntime") return { ensureSqliteRuntime: sqlite };
      if (name === "./hooks/trayRuntime") return { ensureTrayRuntime: tray };
      if (name === "./src/cli/appDataDir") return { getAppDataDir: () => "/private/data" };
      if (name.startsWith("./")) return {};
      return require(name);
    },
  };
  try {
    const mode = vm.runInNewContext(source.slice(0, source.indexOf("// Always use Node.js runtime")) +
      ";({ headless, trayMode, noBrowser, skipUpdate })", context);
    expect(tray).not.toHaveBeenCalled();
    // Execute the actual tray initializer with its real lazy hook invocation.
    const initializer = source.slice(source.indexOf("  const initTrayIcon = () =>"), source.indexOf("  // Headless keeps"));
    const initTray = vi.fn();
    vm.runInNewContext(initializer + ";initTrayIcon()", {
      headless: mode.headless, port: 20128,
      require: (name) => name === "./hooks/trayRuntime" ? { ensureTrayRuntime: tray } : { initTray },
    });
    return { mode, tray, sqlite, initTray, env };
  } catch (error) {
    if (error.exit !== undefined) return { exit: error.exit, tray, sqlite };
    throw error;
  }
}

function hook(provided = []) {
  const install = vi.fn(() => ({ ok: false }));
  const writes = { mkdirSync: vi.fn(), writeFileSync: vi.fn(), chmodSync: vi.fn(), rmSync: vi.fn() };
  const attempts = [];
  const module = { exports: {} };
  vm.runInNewContext(hookSource, {
    module, console, process: { platform: "linux" },
    require: (name) => {
      if (name === "fs") return { ...writes, existsSync: () => false };
      if (name === "path") return path;
      if (name === "child_process") return {};
      if (name === "./sqliteRuntime") return {
        getRuntimeNodeModules: () => "/private/runtime/node_modules",
        getRuntimeDir: () => "/private/runtime", runNpmInstall: install,
      };
      attempts.push(name);
      if (provided.includes(name)) return { default: class SysTray {} };
      throw new Error("MODULE_NOT_FOUND");
    },
  });
  return { result: module.exports.ensureTrayRuntime({ silent: true }), install, writes, attempts };
}

describe("explicit headless startup", () => {
  it.each([
    ["--headless"], ["--headless", "--skip-update"],
    ["--tray", "--headless"], ["--headless", "--tray", "--skip-update"],
  ])("suppresses optional tray hooks and launch for %j", (...args) => {
    const run = startup(args, false, { TRAY_MODE: "1" });
    expect(run.mode).toMatchObject({ headless: true, trayMode: false, noBrowser: true });
    expect(run.env.TRAY_MODE).toBeUndefined();
    expect(run.tray).not.toHaveBeenCalled();
    expect(run.initTray).not.toHaveBeenCalled();
    expect(run.sqlite).toHaveBeenCalledOnce();
  });

  it("retains non-TTY updater tray fallback without headless", () => {
    const run = startup(["--skip-update"]);
    expect(run.mode.trayMode).toBe(true);
    expect(run.tray).toHaveBeenCalledOnce();
  });

  it("retains explicit tray preparation", () => {
    expect(startup(["--tray"], true).tray).toHaveBeenCalledOnce();
  });

  it("does not redefine no-browser as headless", () => {
    expect(startup(["--no-browser"], true).mode).toMatchObject({ headless: false, noBrowser: true });
  });

  it.each(["--help", "--version"])("preserves %s before runtime preparation", (flag) => {
    const run = startup([flag]);
    expect(run.exit).toBe(0);
    expect(run.sqlite).not.toHaveBeenCalled();
    expect(run.tray).not.toHaveBeenCalled();
  });
});

// Run the complete production startServer function, including its nested worker
// event/restart/recovery functions. Only external effects are mocked.
function startHeadlessWorker({ staleOwnership = false, cleanupOk = true } = {}) {
  const children = [];
  const timers = [];
  const process = new EventEmitter();
  process.env = {};
  process.exit = vi.fn();
  process.kill = vi.fn();
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4000 + children.length;
    child.exitCode = null;
    child.signalCode = null;
    children.push(child);
    return child;
  });
  const stopMitm = vi.fn(() => cleanupOk);
  const identity = vi.fn(() => Promise.resolve());
  const ui = vi.fn(() => { throw new Error("Headless must not initialize UI"); });
  const log = { log: vi.fn(), error: vi.fn() };
  vm.runInNewContext(source.slice(source.indexOf("const MAX_RESTARTS =")) + ";startServer(null)", {
    headless: true, trayMode: false, showLog: false,
    host: "127.0.0.1", DEFAULT_HOST: "0.0.0.0", port: 20128,
    getDisplayHost: () => "127.0.0.1", console: log, process, spawn,
    RUNTIME: "/node", serverPath: "/app/custom-server.js", standaloneDir: "/app",
    buildNodeArgs: (serverPath) => [serverPath], buildEnvWithRuntime: (env) => env,
    Date: { now: () => 100 }, setTimeout: (fn, delay) => timers.push({ fn, delay }),
    crypto: { randomBytes: () => Buffer.alloc(24, 1) },
    isIntentionalWorkerHandoff: require("../../cli/src/cli/workerExit.js").isIntentionalWorkerHandoff,
    INTENTIONAL_HANDOFF_EXIT_CODE: 75, hasStaleMitmOwnership: () => staleOwnership,
    waitForWorkerIdentity: identity, stopMitmViaManagerSync: stopMitm,
    path, getAppDataDir: () => "/data", killByPidFile: vi.fn(),
    killTunnelByPidFile: vi.fn(), sleepSync: vi.fn(),
    waitServerReady: ui, showInterfaceMenu: ui, openBrowser: ui,
    require: (name) => {
      if (name === "./src/cli/tray/tray") return { killTray: vi.fn() };
      return ui(name);
    },
  });
  return { children, timers, process, spawn, stopMitm, identity, ui, log };
}

describe("complete headless worker lifecycle", () => {
  it("attaches initial error/close handlers exactly once without starting UI", () => {
    const run = startHeadlessWorker();
    expect(run.children).toHaveLength(1);
    expect(run.children[0].listenerCount("error")).toBe(1);
    expect(run.children[0].listenerCount("close")).toBe(1);
    expect(run.log.log).toHaveBeenCalledWith("Server: http://127.0.0.1:20128");
    expect(run.ui).not.toHaveBeenCalled();
  });

  it.each(["error", "close"])("restarts after worker %s and attaches replacement handlers", (event) => {
    const run = startHeadlessWorker();
    run.children[0].emit(event, event === "error" ? new Error("spawn failed") : 1);
    expect(run.timers.map(({ delay }) => delay)).toEqual([1000]);
    run.timers.shift().fn();
    expect(run.children).toHaveLength(2);
    expect(run.spawn).toHaveBeenLastCalledWith("/node", ["/app/custom-server.js"],
      expect.objectContaining({ env: { PORT: "20128", HOSTNAME: "127.0.0.1" } }));
    expect(run.children[1].listenerCount("error")).toBe(1);
    expect(run.children[1].listenerCount("close")).toBe(1);
    expect(run.process.exit).not.toHaveBeenCalled();
  });

  it("exits cleanly for a validated intentional handoff", () => {
    const run = startHeadlessWorker();
    run.children[0].emit("close", 75);
    expect(run.process.exit).toHaveBeenCalledWith(0);
    expect(run.timers).toEqual([]);
    expect(run.stopMitm).not.toHaveBeenCalled();
  });

  it("rejects a handoff with stale MITM ownership and restarts", () => {
    const run = startHeadlessWorker({ staleOwnership: true });
    run.children[0].emit("close", 75);
    expect(run.process.exit).not.toHaveBeenCalled();
    expect(run.timers.map(({ delay }) => delay)).toEqual([1000]);
    run.timers.shift().fn();
    expect(run.children).toHaveLength(2);
  });

  it.each([true, false])("performs bounded recovery after restart exhaustion, cleanup=%s", async (cleanupOk) => {
    const run = startHeadlessWorker({ cleanupOk });
    run.children[0].emit("close", 1);
    run.timers.shift().fn();
    run.children[1].emit("close", 1);
    expect(run.timers[0].delay).toBe(2000);
    run.timers.shift().fn();
    run.children[2].emit("close", 1);
    expect(run.children).toHaveLength(4);
    const recovery = run.children[3];
    const nonce = "01".repeat(24);
    expect(run.spawn).toHaveBeenLastCalledWith("/node", ["/app/custom-server.js"],
      expect.objectContaining({ env: { PORT: "20128", HOSTNAME: "127.0.0.1", DURINDOOR_WORKER_NONCE: nonce } }));
    expect(run.identity).toHaveBeenCalledWith(recovery, nonce);
    expect(run.stopMitm).not.toHaveBeenCalled();
    await run.identity.mock.results[0].value;
    expect(run.stopMitm).toHaveBeenCalledWith(20128, { preserveDesiredState: false });
    expect(recovery.listenerCount("error")).toBe(1);
    expect(recovery.listenerCount("close")).toBe(1);
    if (cleanupOk) {
      expect(run.process.exit).toHaveBeenCalledWith(1);
      expect(run.process.kill).toHaveBeenCalledWith(recovery.pid, "SIGTERM");
    } else {
      expect(run.process.exit).not.toHaveBeenCalled();
      expect(run.process.kill).not.toHaveBeenCalled();
      // The recovery worker stays owned rather than entering another crash loop.
      recovery.emit("close", 1);
    }
    expect(run.timers).toEqual([]);
    expect(run.ui).not.toHaveBeenCalled();
  });
});

describe("tray preparation resolves actual implementations", () => {
  it.each(["systray2", "systray"])("accepts provided %s without install or payload mutation", (name) => {
    const run = hook([name]);
    expect(run.result).toEqual({ systray: true });
    expect(run.install).not.toHaveBeenCalled();
    for (const write of Object.values(run.writes)) expect(write).not.toHaveBeenCalled();
  });

  it("prefers runtime systray2 before package resolution", () => {
    const run = hook(["/private/runtime/node_modules/systray2", "systray2"]);
    expect(run.attempts).toEqual(["/private/runtime/node_modules/systray2"]);
    expect(run.install).not.toHaveBeenCalled();
  });

  it("repairs missing or unloadable implementations through the existing installer", () => {
    const run = hook();
    expect(run.result).toEqual({ systray: false });
    expect(run.install).toHaveBeenCalledWith(expect.objectContaining({
      pkgs: ["systray2@2.1.4"], timeout: 120000,
    }));
    expect(run.writes.mkdirSync).toHaveBeenCalledWith("/private/runtime", { recursive: true });
  });
});
