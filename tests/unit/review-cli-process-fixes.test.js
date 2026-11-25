import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import processScan from "../../cli/src/lib/processScan.js";

const require = createRequire(import.meta.url);
const cliSource = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

const {
  APP_PROCESS_IDENTIFIERS,
  collectAppPids,
  isAppProcess,
  ownsCloudflared,
  ownsTrayProcess,
} = processScan;

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-proc-scan-"));
  tempDirs.push(dir);
  return dir;
}

describe("#2204 — cloudflared ownership filtering", () => {
  const installDir = "/usr/lib/node_modules/durindoor";
  const dataDir = "/home/me/.9router";
  const appDir = "/usr/lib/node_modules/durindoor/app";

  it("spares unrelated cloudflared tunnels and kills only tunnels targeting this app port", () => {
    const rows = [
      { pid: 101, command: "/usr/local/bin/cloudflared tunnel --config /etc/cloudflared/prod.yml run" },
      { pid: 102, command: "/usr/local/bin/cloudflared tunnel run --token eyJhbGciOiJIUzI1NiJ9" },
      { pid: 103, command: "/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8080" },
      { pid: 104, command: "/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:201280" },
      { pid: 105, command: "/usr/local/bin/cloudflared tunnel --metrics 127.0.0.1:20128 run other" },
      { pid: 106, command: "/usr/local/bin/cloudflared tunnel --url http://example.com:20128" },
      { pid: 107, command: "/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:20128 --no-autoupdate" },
      { pid: 108, command: "/usr/local/bin/cloudflared tunnel --url=http://localhost:20128" },
      { pid: 109, command: "cloudflared tunnel --url http://[::1]:20128/" },
    ];
    const readCommand = (pid) => rows.find((r) => r.pid === pid)?.command ?? null;

    const pids = collectAppPids({
      processes: rows,
      readCommand,
      exclude: new Set(),
      installDir,
      dataDir,
      appDir,
      appPort: 20128,
    });

    expect(pids).toEqual([107, 108, 109]);
  });

  it("matches a named cloudflared tunnel only when its PID is recorded in cloudflared.pid", () => {
    const tmp = makeTempDir();
    const tunnelDir = path.join(tmp, "tunnel");
    fs.mkdirSync(tunnelDir, { recursive: true });
    const pidFile = path.join(tunnelDir, "cloudflared.pid");
    fs.writeFileSync(pidFile, "202\n", "utf8");

    const rows = [
      { pid: 201, command: "/usr/local/bin/cloudflared tunnel run --token other-token" },
      { pid: 202, command: "/home/me/.9router/bin/cloudflared tunnel run --token our-token" },
    ];
    const readCommand = (pid) => rows.find((r) => r.pid === pid)?.command ?? null;

    const pids = collectAppPids({
      processes: rows,
      readCommand,
      exclude: new Set(),
      installDir,
      dataDir: tmp,
      appDir,
      appPort: 20128,
      cloudflaredPidFile: pidFile,
    });

    expect(pids).toEqual([202]);
  });

  it("fails closed for cloudflared when neither appPort nor cloudflared.pid is provided", () => {
    const rows = [
      { pid: 301, command: "/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:20128" },
    ];
    expect(collectAppPids({
      processes: rows,
      readCommand: () => rows[0].command,
      exclude: new Set(),
    })).toEqual([]);
    expect(ownsCloudflared(301, rows[0].command, {})).toBe(false);
  });

  it("rejects non-cloudflared commands that merely mention cloudflared", () => {
    expect(isAppProcess("vim /etc/cloudflared/config.yml")).toBe(false);
    expect(isAppProcess("grep -r cloudflared /var/log")).toBe(false);
  });
});

describe("#2204 — tray binary ownership filtering", () => {
  const installDir = "/usr/lib/node_modules/durindoor";
  const dataDir = "/home/me/.9router";
  const appDir = "/usr/lib/node_modules/durindoor/app";

  it("kills tray binaries under this install or data directory and spares unrelated tray binaries", () => {
    const rows = [
      { pid: 401, command: "/opt/other-app/node_modules/systray2/traybin/tray_linux_release" },
      { pid: 402, command: "/usr/lib/node_modules/durindoor-other/node_modules/systray2/traybin/tray_linux_release" },
      { pid: 403, command: "/usr/lib/node_modules/durindoor/../other-app/tray_linux_release" },
      { pid: 404, command: "tray_linux_release" },
      { pid: 405, command: "/usr/lib/node_modules/durindoor/node_modules/systray2/traybin/tray_linux_release" },
      { pid: 406, command: "/home/me/.9router/runtime/node_modules/systray2/traybin/tray_darwin_release" },
      { pid: 407, command: "/bin/cat /home/me/.9router/runtime/tray_linux_release" },
    ];
    const readCommand = (pid) => rows.find((r) => r.pid === pid)?.command ?? null;

    const pids = collectAppPids({
      processes: rows,
      readCommand,
      exclude: new Set(),
      installDir,
      dataDir,
      appDir,
      appPort: 20128,
    });

    expect(pids).toEqual([405, 406]);
  });

  it("enforces install directory ownership on Windows paths and spaces in paths", () => {
    expect(ownsTrayProcess(
      '"C:\\Program Files\\durindoor\\node_modules\\systray2\\traybin\\tray_windows_release.exe"',
      { installDir: "C:\\Program Files\\durindoor" },
      "win32",
    )).toBe(true);
    expect(ownsTrayProcess(
      "C:\\OtherApp\\tray_windows_release.exe",
      { installDir: "C:\\Program Files\\durindoor" },
      "win32",
    )).toBe(false);
    expect(ownsTrayProcess(
      "/Users/Jane Doe/.9router/runtime/tray_darwin_release",
      { dataDir: "/Users/Jane Doe/.9router" },
      "darwin",
    )).toBe(true);
  });

  it("fails closed for tray binaries when no installation directory is provided", () => {
    const rows = [{ pid: 450, command: "/home/me/.9router/runtime/tray_linux_release" }];
    expect(collectAppPids({
      processes: rows,
      readCommand: () => rows[0].command,
      exclude: new Set(),
    })).toEqual([]);
    expect(ownsTrayProcess(rows[0].command, {})).toBe(false);
  });
});

describe("#2205 — durindoor and legacy 9router launcher recognition", () => {
  it("recognizes durindoor and legacy 9router launchers while excluding updaters and lookalikes", () => {
    expect(APP_PROCESS_IDENTIFIERS).toEqual(["durindoor", "9router"]);

    for (const command of [
      "node /usr/lib/node_modules/durindoor/cli.js -p 20128",
      "node /usr/local/bin/durindoor --tray",
      "node /usr/lib/node_modules/durindoor/app/custom-server.js",
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\durindoor\\cli.js"',
      "node /usr/lib/node_modules/9router/cli.js -p 20128",
      "node /usr/local/bin/9router",
    ]) {
      expect(isAppProcess(command), command).toBe(true);
    }

    for (const command of [
      "node /home/me/.durindoor/runtime/updater/updater.js",
      "node /home/me/.9router/runtime/updater/updater.js",
      "node /home/me/durindoor-other/index.js",
      "npm i -g durindoor@latest --prefer-online",
      "/bin/bash -c node /usr/lib/node_modules/durindoor/cli.js",
      "vim /home/me/notes/durindoor.md",
    ]) {
      expect(isAppProcess(command), command).toBe(false);
    }
  });

  it.each(["durindoor", "9router"])("collects launcher processes owned by the %s install", (name) => {
    const installDir = path.join(makeTempDir(), name);
    fs.mkdirSync(installDir);
    const launcherCli = path.join(installDir, "cli.js");
    fs.writeFileSync(launcherCli, "");
    const rows = [
      { pid: 501, command: `node "${launcherCli}" --port 20128 --tray` },
      { pid: 502, command: `node "${launcherCli}" -p 20128` },
      { pid: 503, command: "node /home/me/.durindoor/runtime/updater/updater.js" },
    ];
    const readCommand = (pid) => rows.find((r) => r.pid === pid)?.command ?? null;
    expect(collectAppPids({ processes: rows, readCommand, exclude: new Set(), installDir, appPort: 20128 })).toEqual([501, 502]);
  });

  it("wires installation ownership bounds in cli.js and removes dead PROCESS_IDENTIFIERS", () => {
    expect(cliSource).not.toContain("PROCESS_IDENTIFIERS");
    const killBlock = cliSource.slice(
      cliSource.indexOf("function killAllAppProcesses"),
      cliSource.indexOf("function sleepSync"),
    );
    expect(killBlock).toContain("installDir: __dirname");
    expect(killBlock).toContain("appPort,");
    expect(killBlock).toContain('path.join(dataDir, "tunnel", "cloudflared.pid")');
  });
});

function startTrayWorker({ staleOwnership = false, cleanupOk = true } = {}) {
  const children = [];
  const timers = [];
  const proc = new EventEmitter();
  proc.env = {};
  proc.exit = vi.fn();
  proc.kill = vi.fn();

  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 6000 + children.length;
    child.exitCode = null;
    child.signalCode = null;
    children.push(child);
    return child;
  });

  const stopMitm = vi.fn(() => cleanupOk);
  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  const waitServerReady = vi.fn(() => readyPromise);

  let resolveIdentity;
  const identityPromise = new Promise((resolve) => { resolveIdentity = resolve; });
  const waitForWorkerIdentity = vi.fn(() => identityPromise);

  const initTray = vi.fn();
  const ensureTrayRuntime = vi.fn();
  const killTray = vi.fn();
  const showInterfaceMenu = vi.fn(() => { throw new Error("trayMode must not start TUI menu"); });
  const log = { log: vi.fn(), error: vi.fn() };

  vm.runInNewContext(cliSource.slice(cliSource.indexOf("const MAX_RESTARTS ="), cliSource.indexOf("function main(")) + ";startServer(null)", {
    headless: false,
    trayMode: true,
    showLog: false,
    host: "127.0.0.1",
    DEFAULT_HOST: "0.0.0.0",
    port: 20128,
    DISPLAY_NAME: "DurinDoor",
    pkg: { name: "durindoor", version: "4.11.0" },
    getDisplayHost: () => "127.0.0.1",
    console: log,
    process: proc,
    spawn,
    RUNTIME: "/node",
    serverPath: "/app/custom-server.js",
    standaloneDir: "/app",
    buildNodeArgs: (serverPath) => [serverPath],
    buildEnvWithRuntime: (env) => env,
    Date: { now: () => 100 },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    crypto: { randomBytes: () => Buffer.alloc(24, 2) },
    isIntentionalWorkerHandoff: require("../../cli/src/cli/workerExit.js").isIntentionalWorkerHandoff,
    INTENTIONAL_HANDOFF_EXIT_CODE: 75,
    hasStaleMitmOwnership: () => staleOwnership,
    waitForWorkerIdentity,
    stopMitmViaManagerSync: stopMitm,
    path,
    getAppDataDir: () => "/data",
    killByPidFile: vi.fn(),
    killTunnelByPidFile: vi.fn(),
    sleepSync: vi.fn(),
    waitServerReady,
    showInterfaceMenu,
    openBrowser: vi.fn(),
    require: (name) => {
      if (name === "./hooks/trayRuntime") return { ensureTrayRuntime };
      if (name === "./src/cli/tray/tray") return { initTray, killTray };
      throw new Error(`Unexpected require in trayMode test: ${name}`);
    },
  });

  return {
    children,
    timers,
    process: proc,
    spawn,
    stopMitm,
    waitServerReady,
    resolveReady,
    waitForWorkerIdentity,
    resolveIdentity,
    initTray,
    ensureTrayRuntime,
    showInterfaceMenu,
    log,
  };
}

describe("#2205 — trayMode worker restart and exit lifecycle", () => {
  it("attaches error and close handlers immediately in trayMode and ignores SIGHUP", async () => {
    const run = startTrayWorker();
    expect(run.children).toHaveLength(1);
    expect(run.children[0].listenerCount("error")).toBe(1);
    expect(run.children[0].listenerCount("close")).toBe(1);
    expect(run.process.listenerCount("SIGHUP")).toBe(1);
    // SIGHUP must be a no-op in trayMode (must not trigger cleanup/exit).
    run.process.emit("SIGHUP");
    expect(run.process.exit).not.toHaveBeenCalled();

    run.resolveReady(true);
    await new Promise(setImmediate);
    expect(run.ensureTrayRuntime).toHaveBeenCalledOnce();
    expect(run.initTray).toHaveBeenCalledOnce();
    expect(run.showInterfaceMenu).not.toHaveBeenCalled();
  });

  it.each(["error", "close"])("restarts worker after %s in trayMode and wires handlers on replacement", (event) => {
    const run = startTrayWorker();
    run.children[0].emit(event, event === "error" ? new Error("boom") : 1);
    expect(run.timers.map(({ delay }) => delay)).toEqual([1000]);
    run.timers.shift().fn();
    expect(run.children).toHaveLength(2);
    expect(run.children[1].listenerCount("error")).toBe(1);
    expect(run.children[1].listenerCount("close")).toBe(1);
    expect(run.process.exit).not.toHaveBeenCalled();
  });

  it("handles intentional worker handoff cleanly in trayMode and skips late tray init", async () => {
    const run = startTrayWorker({ staleOwnership: false });
    run.children[0].emit("close", 75);
    expect(run.process.exit).toHaveBeenCalledWith(0);
    expect(run.timers).toEqual([]);

    run.resolveReady(true);
    await new Promise(setImmediate);
    expect(run.initTray).not.toHaveBeenCalled();
  });

  it("rejects handoff with stale MITM ownership and triggers bounded recovery after restart exhaustion", async () => {
    const run = startTrayWorker({ staleOwnership: true, cleanupOk: true });
    run.children[0].emit("close", 75);
    expect(run.process.exit).not.toHaveBeenCalled();
    run.timers.shift().fn();
    run.children[1].emit("close", 0);
    run.timers.shift().fn();
    run.children[2].emit("close", 1);

    expect(run.children).toHaveLength(4);
    run.resolveReady(false);
    await new Promise(setImmediate);
    expect(run.initTray).not.toHaveBeenCalled();

    run.resolveIdentity();
    await new Promise(setImmediate);
    expect(run.stopMitm).toHaveBeenCalledWith(20128, { preserveDesiredState: false });
    expect(run.process.exit).toHaveBeenCalledWith(1);
  });
});
