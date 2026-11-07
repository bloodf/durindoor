import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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

  it("returns before menu and tray dispatch in headless server startup", () => {
    const dispatch = source.slice(source.indexOf("  // Headless keeps"), source.indexOf("  // Tray-only mode"));
    const ui = vi.fn();
    const log = vi.fn();
    vm.runInNewContext(`(function () { ${dispatch}; ui(); })()`, {
      headless: true, console: { log }, displayHost: "127.0.0.1", port: 20128, ui,
    });
    expect(log).toHaveBeenCalledWith("Server: http://127.0.0.1:20128");
    expect(ui).not.toHaveBeenCalled();
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
