// macOS ownership for website browser shard cleanup.
//
// macOS has no /proc, so cleanup proves ownership from one `ps -E` snapshot.
// These tests run on every platform: the process table is injected and every
// kill is a mock, so no real process (owned or unrelated) is ever signalled.
// The last block runs only on a real macOS host and signals only children
// this test spawned with a token it generated.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DARWIN_PS,
  DARWIN_PS_ARGS,
  SHARD_OWNER_ENV,
  cleanupShardServer,
  findOwnedDarwinProcesses,
  newShardOwnerToken,
  ownedDarwinProcesses,
  ownershipSource,
  parseDarwinProcessTable,
  reserveLoopbackPort,
  runDarwinPs,
  signalOwnedDarwinProcesses,
} from "../../scripts/lib/website-shard-server.mjs";

const owner = "e".repeat(32);
const other = "f".repeat(32);
const euid = 501;
const missingProc = path.join(os.tmpdir(), "durindoor-no-proc-here", "proc");
const START = "Fri Nov 27 05:14:59 2026";
const tempDirs = [];
const tracked = [];

afterEach(() => {
  for (const pid of tracked.splice(0)) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// One `ps -axww -E -o pid=,ppid=,uid=,pgid=,stat=,lstart=,command=` line.
const row = ({ pid, ppid = 1, uid = euid, pgid = pid, stat = "S", start = START, cmd = "node server.js", token }) =>
  `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(uid).padStart(5)} ${String(pgid).padStart(5)} ${stat.padEnd(4)} ${start} ${cmd} PATH=/usr/bin${token ? ` ${SHARD_OWNER_ENV}=${token}` : ""}`;

// A mutable fake process table served through the injected ps runner.
function fakeTable(rows) {
  const table = { rows: [...rows], calls: 0 };
  table.runPs = () => {
    table.calls += 1;
    return { stdout: `${table.rows.map(row).join("\n")}\n`, pid: 99_999 };
  };
  table.remove = (pid) => { table.rows = table.rows.filter((r) => r.pid !== pid); };
  return table;
}

describe("darwin process table parsing", () => {
  it("parses pid, parent, uid, group, state, start time and words", () => {
    const [p] = parseDarwinProcessTable(row({ pid: 700, ppid: 600, pgid: 650, stat: "Ss", start: "Sat Nov  7 01:02:03 2026", token: owner }));
    expect(p).toMatchObject({ pid: 700, ppid: 600, uid: euid, pgid: 650, state: "Ss", startTime: "Sat Nov 7 01:02:03 2026" });
    expect(p.words).toContain(`${SHARD_OWNER_ENV}=${owner}`);
  });

  it("fails closed on empty output and on any unparseable line", () => {
    expect(() => parseDarwinProcessTable("")).toThrow(/empty process table/);
    expect(() => parseDarwinProcessTable(`${row({ pid: 700 })}\ngarbage line\n`)).toThrow(/unparseable ps line/);
  });

  it("runs /bin/ps with a fixed locale, a minimal environment and a timeout", () => {
    const spawn = vi.fn(() => ({ status: 0, signal: null, stdout: row({ pid: 700 }), pid: 42 }));
    expect(runDarwinPs({ spawn })).toEqual({ stdout: row({ pid: 700 }), pid: 42 });
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(DARWIN_PS);
    expect(args).toEqual(DARWIN_PS_ARGS);
    expect(args).toContain("-E");
    expect(options.env).toEqual({ PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C" });
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("turns ps spawn errors, signals and non-zero exits into enumeration errors", () => {
    const run = (result) => () => runDarwinPs({ spawn: () => result });
    expect(run({ error: Object.assign(new Error("nope"), { code: "ENOENT" }) })).toThrow(/cannot enumerate owned processes: ps ENOENT/);
    expect(run({ status: null, signal: "SIGTERM", stdout: "" })).toThrow(/terminated by SIGTERM/);
    expect(run({ status: 1, signal: null, stdout: "" })).toThrow(/exited with status 1/);
  });
});

describe("darwin ownership", () => {
  it("selects ps on macOS without procfs, and nothing on Linux without procfs", () => {
    expect(ownershipSource({ procRoot: missingProc, platform: "darwin" })).toBe("darwin-ps");
    expect(ownershipSource({ procRoot: missingProc, platform: "linux" })).toBeNull();
    expect(ownershipSource({ procRoot: missingProc, platform: "freebsd" })).toBeNull();
  });

  it("owns token carriers and their same-uid descendants only", () => {
    const table = parseDarwinProcessTable([
      row({ pid: 100, token: owner }), // launcher
      row({ pid: 101, ppid: 100, pgid: 100 }), // next start (token stripped, still a child)
      row({ pid: 102, ppid: 101, pgid: 100 }), // grandchild
      row({ pid: 200, token: other }), // another shard
      row({ pid: 201, ppid: 200 }), // its child
      row({ pid: 300 }), // unrelated, same uid
      row({ pid: 301, ppid: 100, uid: 0 }), // child running as another uid
      row({ pid: 400, uid: 502, token: owner }), // token but another uid
      row({ pid: 500, stat: "Z", token: owner }), // zombie
      row({ pid: 600, cmd: `grep ${SHARD_OWNER_ENV}=${owner}x` }), // near-miss word
      row({ pid: 700, token: owner }), // this runner (excluded)
    ].join("\n"));
    const owned = ownedDarwinProcesses(table, owner, { euid, excludePids: [700] });
    expect(owned.map((p) => [p.pid, p.via])).toEqual([[100, "token"], [101, "descendant"], [102, "descendant"]]);
  });

  it("excludes this runner and the ps process itself", () => {
    const table = fakeTable([{ pid: 4242, token: owner }, { pid: 99_999, token: owner }, { pid: 100, token: owner }]);
    expect(findOwnedDarwinProcesses(owner, { euid, selfPid: 4242, runPs: table.runPs }).map((p) => p.pid)).toEqual([100]);
  });

  it("re-verifies before signalling and skips PIDs reused after the scan", () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 110, ppid: 100, pgid: 100 }, { pid: 120, token: owner, pgid: 1 }]);
    const seen = findOwnedDarwinProcesses(owner, { euid, selfPid: 0, runPs: table.runPs });
    // 120 exits and an unrelated program gets its PID; 110 is reparented but
    // keeps its start time and is still a descendant of 100.
    table.remove(120);
    table.rows.push({ pid: 120, pgid: 1, start: "Fri Nov 27 06:00:00 2026" });
    const kill = vi.fn();
    const signalled = signalOwnedDarwinProcesses(seen, "SIGTERM", { owner, euid, selfPid: 0, kill, runPs: table.runPs });
    expect(kill.mock.calls).toEqual([[-100, "SIGTERM"], [110, "SIGTERM"]]);
    expect(signalled.map((s) => s.pid)).toEqual([100, 110]);
  });
});

describe("darwin cleanup", () => {
  const probe = async () => false;
  const base = { port: 4000, procRoot: missingProc, platform: "darwin", euid, probe, pollMs: 1 };

  it("fails closed when the process table cannot be enumerated, even with a free port", async () => {
    const kill = vi.fn();
    const result = await cleanupShardServer({
      ...base, owner, kill, selfExitMs: 0,
      runPs: () => { throw new Error("cannot enumerate owned processes: ps exited with status 1"); },
    });
    expect(result).toMatchObject({ ok: false, verification: "darwin-ps" });
    expect(result.reason).toMatch(/ps exited with status 1/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails closed on an unparseable table", async () => {
    const result = await cleanupShardServer({ ...base, owner, kill: vi.fn(), selfExitMs: 0, runPs: () => ({ stdout: "nonsense\n", pid: 1 }) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unparseable/);
  });

  it("succeeds when no owned process or descendant is alive and leaves unrelated ones alone", async () => {
    const table = fakeTable([{ pid: 300 }, { pid: 200, token: other }, { pid: 201, ppid: 200 }]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, runPs: table.runPs });
    expect(result).toMatchObject({ ok: true, verification: "darwin-ps", survivors: [], signalled: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("terminates the owned tree, never the unrelated process holding the same uid", async () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 101, ppid: 100, pgid: 100 }, { pid: 300 }, { pid: 200, token: other }]);
    const kill = vi.fn((target, signal) => {
      // The group signal ends the launcher and its child.
      if (target === -100 && signal === "SIGTERM") { table.remove(100); table.remove(101); }
    });
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, termMs: 200, runPs: table.runPs });
    expect(result).toMatchObject({ ok: true, survivors: [] });
    const targets = kill.mock.calls.map(([target]) => target);
    expect(targets).toContain(-100);
    expect(targets).not.toContain(300);
    expect(targets).not.toContain(-300);
    expect(targets).not.toContain(200);
    expect(targets).not.toContain(-200);
  });

  it("reports a live owned descendant that survives SIGTERM and SIGKILL", async () => {
    // The token carrier is gone; its child was reparented to launchd and
    // ignores signals. It is still owned via the token it inherited.
    const table = fakeTable([{ pid: 101, ppid: 1, pgid: 101, token: owner }, { pid: 102, ppid: 101, pgid: 101 }]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, termMs: 5, killMs: 5, runPs: table.runPs });
    expect(result.ok).toBe(false);
    expect(result.survivors).toEqual([101, 102]);
    expect(result.reason).toMatch(/survived cleanup: 101, 102/);
    expect(kill.mock.calls.map(([target, signal]) => `${target}:${signal}`)).toEqual(["-101:SIGTERM", "102:SIGTERM", "-101:SIGKILL", "102:SIGKILL"]);
  });

  it("fails when the kernel refuses a signal", async () => {
    const table = fakeTable([{ pid: 100, token: owner }]);
    const kill = vi.fn(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, runPs: table.runPs });
    expect(result).toMatchObject({ ok: false, survivors: [100] });
    expect(result.reason).toMatch(/signal failed: EPERM/);
  });

  it("removes this shard's state file only after a verified cleanup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shard-darwin-"));
    tempDirs.push(dir);
    const stateFile = path.join(dir, "s.json");
    fs.writeFileSync(stateFile, JSON.stringify({ owner, port: 4000 }), { mode: 0o600 });
    const table = fakeTable([{ pid: 300 }]);
    const result = await cleanupShardServer({ ...base, owner, stateFile, euid: process.geteuid(), selfExitMs: 5, runPs: table.runPs });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});

describe.skipIf(process.platform !== "darwin")("darwin host process table", () => {
  it("finds and cleans up a real owned server tree and leaves an unrelated child alone", async () => {
    const token = newShardOwnerToken();
    const port = await reserveLoopbackPort();
    const script = `require("node:net").createServer().listen(${port}, "127.0.0.1"); setInterval(() => {}, 1000);`;
    const owned = spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH, [SHARD_OWNER_ENV]: token } });
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: { PATH: process.env.PATH } });
    tracked.push(owned.pid, unrelated.pid);
    const deadline = Date.now() + 10_000;
    while (!findOwnedDarwinProcesses(token).some((p) => p.pid === owned.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(findOwnedDarwinProcesses(token).map((p) => p.pid)).toEqual([owned.pid]);
    const result = await cleanupShardServer({ owner: token, port, selfExitMs: 200, termMs: 5_000, killMs: 5_000 });
    expect(result).toMatchObject({ ok: true, verification: "darwin-ps", survivors: [] });
    expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
  });
});
