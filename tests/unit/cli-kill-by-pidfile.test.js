import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { killByPidFile } = require("../../cli/hooks/killByPidFile.js");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(ch, timeoutMs = 2000) {
  if (ch.exitCode !== null || ch.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { ch.off("exit", onExit); resolve(); }, timeoutMs);
    const onExit = () => { clearTimeout(t); resolve(); };
    ch.once("exit", onExit);
  });
}

describe("killByPidFile (#2324 headroom/proxy.pid shutdown)", () => {
  let tmpDir;
  let child;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-pidfile-"));
  });

  afterEach(() => {
    if (child && !child.killed) {
      try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("kills a live sleeper and removes the pid file (real process)", async () => {
    child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1e9)"], { stdio: "ignore" });
    const pidFile = path.join(tmpDir, "headroom", "proxy.pid");
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(child.pid));
    await new Promise((r) => setTimeout(r, 30));
    expect(isAlive(child.pid)).toBe(true);

    const killed = killByPidFile(pidFile);

    expect(killed).toBe(true);
    await waitForExit(child);
    expect(child.exitCode === null ? child.signalCode : child.exitCode).not.toBeNull();
    expect(isAlive(child.pid)).toBe(false);
    expect(fs.existsSync(pidFile)).toBe(false);
    child = null;
  });

  it("returns false and is a no-op when the pid file is absent", () => {
    const result = killByPidFile(path.join(tmpDir, "missing.pid"));
    expect(result).toBe(false);
  });

  it("returns false and leaves the file when contents are not a pid", () => {
    const pidFile = path.join(tmpDir, "junk.pid");
    fs.writeFileSync(pidFile, "not-a-number");
    const result = killByPidFile(pidFile);
    expect(result).toBe(false);
    expect(fs.existsSync(pidFile)).toBe(true);
  });

  it("removes the pid file even when the recorded pid is already dead", () => {
    const pidFile = path.join(tmpDir, "stale.pid");
    fs.writeFileSync(pidFile, "999999999");
    const result = killByPidFile(pidFile);
    expect(result).toBe(true);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("uses taskkill on win32 (injectable execImpl)", () => {
    const pidFile = path.join(tmpDir, "win.pid");
    fs.writeFileSync(pidFile, "12345");
    const calls = [];
    const fImpl = {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, enc) => fs.readFileSync(p, enc),
      unlinkSync: (p) => fs.unlinkSync(p),
    };
    const execImpl = (cmd) => { calls.push(cmd); };
    const result = killByPidFile(pidFile, { fsImpl: fImpl, execImpl, platform: "win32" });
    expect(result).toBe(true);
    expect(calls).toEqual(["taskkill /F /T /PID 12345"]);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("rejects negative / non-canonical pid values and never calls killImpl", () => {
    for (const bad of ["-1", "0", "1.2", "1e3", "abc", "", "5x"]) {
      const pidFile = path.join(tmpDir, `bad-${bad.replace(/\W/g, "_") || "empty"}.pid`);
      fs.writeFileSync(pidFile, bad);
      const killCalls = [];
      const fImpl = {
        existsSync: () => true,
        readFileSync: () => bad,
        unlinkSync: () => {},
      };
      const result = killByPidFile(pidFile, { fsImpl: fImpl, killImpl: (pid) => killCalls.push(pid) });
      expect(result, `pid=${JSON.stringify(bad)}`).toBe(false);
      expect(killCalls, `pid=${JSON.stringify(bad)} must not kill`).toEqual([]);
    }
  });

  it("tolerates trailing newline in pid file (real fs) and kills", () => {
    const pidFile = path.join(tmpDir, "nl.pid");
    fs.writeFileSync(pidFile, "12345\n");
    const killCalls = [];
    const fImpl = {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, enc) => fs.readFileSync(p, enc),
      unlinkSync: (p) => fs.unlinkSync(p),
    };
    const result = killByPidFile(pidFile, { fsImpl: fImpl, killImpl: (pid) => killCalls.push(pid) });
    expect(result).toBe(true);
    expect(killCalls).toEqual([12345]);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("cli.js wires headroom/proxy.pid kill at BOTH shutdown call sites", () => {
    // Static guard: the headroom proxy kill must survive refactors. Both the
    // upgrade-cleanup path and the normal Ctrl+C/tray quit path must stop the
    // detached headroom proxy (upstream #2324).
    const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/cli.js");
    const src = fs.readFileSync(cliPath, "utf8");
    const needle = 'killByPidFile(path.join(getAppDataDir(), "headroom", "proxy.pid"))';
    const count = src.split(needle).length - 1;
    expect(count).toBe(2);
    expect(src).toContain('require("./hooks/killByPidFile")');
  });
});
