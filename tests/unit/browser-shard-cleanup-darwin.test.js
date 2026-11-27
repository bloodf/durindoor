// macOS ownership for website browser shard cleanup.
//
// macOS has no /proc, so cleanup proves ownership from `ps` snapshots taken
// with and without `-E`. These tests run on every platform: the process
// table is injected (it answers all three `ps` forms the guard uses) and
// every kill is a mock, so no real process, owned or unrelated, is ever
// signalled. The last block runs only on a real macOS host and signals only
// children this test spawned with a token it generated.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DARWIN_PS,
  DARWIN_PS_ARGS,
  DARWIN_PS_ENV,
  DARWIN_PS_ENV_ARGS,
  SHARD_OWNER_ENV,
  cleanupShardServer,
  createDarwinOwnershipTracker,
  darwinEnvironmentWords,
  findOwnedDarwinProcesses,
  newShardOwnerToken,
  ownershipSource,
  parseDarwinProcessTable,
  reserveLoopbackPort,
  runDarwinPs,
  scanDarwinOwnership,
  signalOwnedDarwinProcesses,
} from "../../scripts/lib/website-shard-server.mjs";

const owner = "e".repeat(32);
const other = "f".repeat(32);
const marker = `${SHARD_OWNER_ENV}=${owner}`;
const euid = 501;
const missingProc = path.join(os.tmpdir(), "durindoor-no-proc-here", "proc");
// Processes started well before the (fake) observation time are mature.
const START = "Fri Nov 27 05:14:59 2026";
const NOW = Date.UTC(2026, 10, 27, 5, 20, 0);
const tempDirs = [];
const tracked = [];

afterEach(() => {
  for (const pid of tracked.splice(0)) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const lstart = (ms) => {
  const d = new Date(ms);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const pad = (n) => String(n).padStart(2, "0");
  return `${day} ${mon} ${String(d.getUTCDate()).padStart(2)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
};

// One `ps -o pid=,ppid=,uid=,pgid=,stat=,lstart=,command=` line, padded the
// way macOS pads lstart. `env` is shown only for `-E`, as macOS does.
const line = ({ pid, ppid = 1, uid = euid, pgid = pid, stat = "S", start = START, argv = "node server.js", env = [] }, withEnv) =>
  `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(uid).padStart(5)} ${String(pgid).padStart(5)} ${stat.padEnd(4)} ${start}    ${argv}${withEnv && env.length ? ` ${env.join(" ")}` : ""}`;

// A mutable fake process table served through the injected ps runner. Rows
// with `token` carry the marker in their environment.
function fakeTable(rows, { onCall } = {}) {
  const norm = (r) => ({ ...r, env: [...(r.env ?? ["PATH=/usr/bin"]), ...(r.token ? [`${SHARD_OWNER_ENV}=${r.token}`] : [])] });
  const table = { rows: rows.map(norm), calls: [] };
  table.runPs = (args) => {
    table.calls.push(args);
    onCall?.(table, args);
    const withEnv = args.includes("-E");
    const p = args.indexOf("-p");
    const rowsNow = p >= 0 ? table.rows.filter((r) => r.pid === Number(args[p + 1])) : table.rows;
    return { stdout: rowsNow.map((r) => `${line(r, withEnv)}\n`).join(""), pid: 99_999 };
  };
  table.remove = (pid) => { table.rows = table.rows.filter((r) => r.pid !== pid); };
  table.add = (r) => { table.rows.push(norm(r)); };
  table.update = (pid, patch) => { table.rows = table.rows.map((r) => (r.pid === pid ? { ...r, ...patch } : r)); };
  return table;
}

const fixedClock = (wall = NOW) => ({ wall: () => wall, mono: () => 0 });
const tracker = (clock = fixedClock()) => createDarwinOwnershipTracker(owner, { euid, selfPid: 4242, clock });
const killLog = (kill) => kill.mock.calls.map(([target, signal]) => `${target}:${signal}`);

describe("darwin process table parsing", () => {
  it("parses pid, parent, uid, group, state, UTC start time and command", () => {
    const table = parseDarwinProcessTable(line({ pid: 700, ppid: 600, pgid: 650, stat: "Ss", start: "Sat Nov  7 01:02:03 2026", argv: "node a.js" }, false));
    expect(table.get(700)).toMatchObject({ pid: 700, ppid: 600, uid: euid, pgid: 650, state: "Ss", startSec: Date.UTC(2026, 10, 7, 1, 2, 3) / 1000, command: "node a.js" });
  });

  it("fails closed on empty output, unparseable lines, bad dates and duplicate PIDs", () => {
    expect(() => parseDarwinProcessTable("")).toThrow(/empty process table/);
    expect(() => parseDarwinProcessTable(`${line({ pid: 700 })}\ngarbage line\n`)).toThrow(/unparseable ps line/);
    expect(() => parseDarwinProcessTable(line({ pid: 700, start: "Fri Feb 31 05:14:59 2026" }))).toThrow(/start time/);
    expect(() => parseDarwinProcessTable(`${line({ pid: 700 })}\n${line({ pid: 700, argv: "forged" })}\n`)).toThrow(/PID 700 twice/);
  });

  it("runs /bin/ps with UTC, a fixed locale, a minimal environment and a timeout", () => {
    const spawn = vi.fn(() => ({ status: 0, signal: null, stdout: line({ pid: 700 }), pid: 42 }));
    expect(runDarwinPs(DARWIN_PS_ENV_ARGS, { spawn })).toEqual({ stdout: line({ pid: 700 }), pid: 42 });
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(DARWIN_PS);
    expect(args).toEqual(DARWIN_PS_ENV_ARGS);
    expect(DARWIN_PS_ARGS).not.toContain("-E");
    expect(options.env).toEqual({ ...DARWIN_PS_ENV });
    expect(options.env.TZ).toBe("UTC0");
    expect(options.env[SHARD_OWNER_ENV]).toBeUndefined();
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("turns ps errors into enumeration errors; only `ps -p` may answer 'gone'", () => {
    const run = (result, args) => () => runDarwinPs(args, { spawn: () => result });
    expect(run({ error: Object.assign(new Error("nope"), { code: "ENOENT" }) })).toThrow(/ps ENOENT/);
    expect(run({ status: null, signal: "SIGTERM", stdout: "" })).toThrow(/terminated by SIGTERM/);
    expect(run({ status: 1, signal: null, stdout: "" })).toThrow(/exited with status 1/);
    expect(run({ status: 1, signal: null, stdout: "" }, ["-o", "pid=", "-p", "7"])()).toEqual({ stdout: "", pid: undefined });
    expect(run({ status: 1, signal: null, stdout: "x" }, ["-o", "pid=", "-p", "7"])).toThrow(/exited with status 1/);
  });
});

describe("darwin ownership", () => {
  it("selects ps on macOS without procfs, and nothing on Linux without procfs", () => {
    expect(ownershipSource({ procRoot: missingProc, platform: "darwin" })).toBe("darwin-ps");
    expect(ownershipSource({ procRoot: missingProc, platform: "linux" })).toBeNull();
    expect(ownershipSource({ procRoot: missingProc, platform: "freebsd" })).toBeNull();
  });

  it("reads the environment only as the -E suffix of unchanged arguments", () => {
    const at = (argv, cmd = argv) => ({ startSec: 1, command: cmd });
    expect(darwinEnvironmentWords(at("node a"), at("node a", `node a PATH=/x ${marker}`), at("node a"))).toEqual(["PATH=/x", marker]);
    expect(darwinEnvironmentWords(at(`sh -c ${marker}`), at(`sh -c ${marker}`), at(`sh -c ${marker}`))).toEqual([]);
    // Arguments changed between the two arguments-only reads (exec).
    expect(darwinEnvironmentWords(at("node a"), at("node a", `node a ${marker}`), at(`node a ${marker}`))).toBeNull();
    // Start time differs: another process.
    expect(darwinEnvironmentWords(at("node a"), { startSec: 2, command: `node a ${marker}` }, at("node a"))).toBeNull();
    expect(darwinEnvironmentWords(undefined, at("node a"), at("node a"))).toBeNull();
  });

  it("owns token carriers and their same-uid descendants only", () => {
    const table = fakeTable([
      { pid: 100, token: owner }, // launcher
      { pid: 101, ppid: 100, pgid: 100 }, // next start (token stripped, still a child)
      { pid: 102, ppid: 101, pgid: 100 }, // grandchild
      { pid: 200, token: other }, // another shard
      { pid: 201, ppid: 200 }, // its child
      { pid: 300 }, // unrelated, same uid
      { pid: 301, ppid: 100, uid: 0 }, // child running as another uid
      { pid: 400, uid: 502, token: owner }, // token but another uid
      { pid: 500, stat: "Z", token: owner }, // zombie
      { pid: 600, env: [`${marker}x`] }, // near-miss word
      { pid: 4242, token: owner }, // this runner (excluded)
    ]);
    const owned = scanDarwinOwnership(tracker(), { runPs: table.runPs });
    expect(owned.map((p) => [p.pid, p.via, p.verified])).toEqual([[100, "token", true], [101, "descendant", true], [102, "descendant", true]]);
  });

  // Review repro 1: the token in an unrelated process's arguments.
  it("never owns a same-uid process that only has the token in its arguments", async () => {
    const table = fakeTable([
      { pid: 300, argv: `grep ${marker}` },
      { pid: 301, argv: `/bin/sh -c sleep 60; : ${marker}`, env: ["PATH=/usr/bin"] },
      { pid: 302, ppid: 301, pgid: 301 },
    ]);
    expect(scanDarwinOwnership(tracker(), { runPs: table.runPs })).toEqual([]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ owner, port: 4000, procRoot: missingProc, platform: "darwin", euid, probe: async () => false, pollMs: 1, selfExitMs: 5, kill, runPs: table.runPs, clock: fixedClock() });
    expect(result).toMatchObject({ ok: true, signalled: [], survivors: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("ignores a token that appears only because the process exec'd between snapshots", () => {
    const table = fakeTable([{ pid: 300, argv: "node a.js" }], {
      onCall: (t, args) => {
        // After the first arguments-only read, the process execs with the
        // token in its arguments (no token in its environment).
        if (t.calls.length === 2 && args.includes("-E")) t.update(300, { argv: `node a.js ${marker}` });
      },
    });
    expect(scanDarwinOwnership(tracker(), { runPs: table.runPs })).toEqual([]);
  });

  it("excludes this runner and every ps process", () => {
    const table = fakeTable([{ pid: 4242, token: owner }, { pid: 99_999, token: owner }, { pid: 100, token: owner }]);
    expect(findOwnedDarwinProcesses(owner, { euid, selfPid: 4242, runPs: table.runPs }).map((p) => p.pid)).toEqual([100]);
  });

  // Review repro 2: an observed tokenless descendant orphaned by its parent.
  it("keeps an observed tokenless descendant owned after its parent exits", () => {
    const table = fakeTable([{ pid: 101, token: owner }, { pid: 102, ppid: 101, pgid: 101 }]);
    const t = tracker();
    expect(scanDarwinOwnership(t, { runPs: table.runPs }).map((p) => p.pid)).toEqual([101, 102]);
    table.remove(101);
    table.update(102, { ppid: 1 });
    expect(scanDarwinOwnership(t, { runPs: table.runPs }).map((p) => [p.pid, p.via, p.verified])).toEqual([[102, "identity", true]]);
    // A new process in the orphaned group is owned through the surviving member.
    table.add({ pid: 103, ppid: 1, pgid: 101 });
    expect(scanDarwinOwnership(t, { runPs: table.runPs }).map((p) => [p.pid, p.via])).toEqual([[102, "identity"], [103, "group"]]);
    // A recycled PID 102 (new start time) is not the tracked process.
    table.remove(102);
    table.remove(103);
    table.add({ pid: 102, ppid: 1, start: lstart(NOW - 2000) });
    expect(scanDarwinOwnership(t, { runPs: table.runPs })).toEqual([]);
  });

  it("reports, but never signals, a member of an owned group that can no longer be proven", () => {
    const table = fakeTable([{ pid: 101, token: owner }]);
    const t = tracker();
    scanDarwinOwnership(t, { runPs: table.runPs });
    table.remove(101);
    // Never observed, tokenless, in group 101, with no owned member left.
    table.add({ pid: 105, ppid: 1, pgid: 101 });
    table.add({ pid: 106, ppid: 105, pgid: 106 });
    const found = scanDarwinOwnership(t, { runPs: table.runPs });
    expect(found.map((p) => [p.pid, p.via, p.verified])).toEqual([[105, "unwitnessed-group", false], [106, "unverified-descendant", false]]);
    const kill = vi.fn();
    expect(signalOwnedDarwinProcesses(found, "SIGTERM", { tracker: t, kill, runPs: table.runPs })).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  // Review repro 3: one snapshot must not authorize later signals.
  it("does not signal a group member again after the group signal, even if its PID is recycled", () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 110, ppid: 100, pgid: 100 }]);
    const t = tracker();
    const seen = scanDarwinOwnership(t, { runPs: table.runPs });
    const kill = vi.fn((target) => {
      if (target === -100) {
        table.remove(100);
        table.remove(110);
        // PID 110 is recycled by an unrelated same-uid program at once.
        table.add({ pid: 110, ppid: 1, pgid: 110, start: lstart(NOW) });
      }
    });
    signalOwnedDarwinProcesses(seen, "SIGTERM", { tracker: t, kill, runPs: table.runPs });
    expect(killLog(kill)).toEqual(["-100:SIGTERM"]);
  });

  it("re-reads every PID right before its own signal", () => {
    const table = fakeTable([{ pid: 120, pgid: 1, token: owner }, { pid: 130, pgid: 1, token: owner }]);
    const t = tracker();
    const seen = scanDarwinOwnership(t, { runPs: table.runPs });
    const kill = vi.fn((target) => {
      if (target === 120) {
        // 130 exits and an unrelated program receives its PID.
        table.remove(130);
        table.add({ pid: 130, pgid: 1, start: lstart(NOW) });
      }
    });
    const signalled = signalOwnedDarwinProcesses(seen, "SIGTERM", { tracker: t, kill, runPs: table.runPs });
    expect(killLog(kill)).toEqual(["120:SIGTERM"]);
    expect(signalled.map((s) => s.pid)).toEqual([120]);
    const pidReads = table.calls.filter((a) => a.includes("-p")).map((a) => a.at(-1));
    expect(pidReads).toEqual(["120", "130"]);
  });

  it("does not signal a process younger than the start-time resolution", () => {
    // Started in the same second it was observed: a PID recycled in that
    // second would carry the same lstart, so the identity is not usable yet.
    const table = fakeTable([{ pid: 100, token: owner, start: lstart(NOW) }]);
    const t = tracker();
    const seen = scanDarwinOwnership(t, { runPs: table.runPs });
    expect(seen).toMatchObject([{ pid: 100, verified: true, mature: false }]);
    const kill = vi.fn();
    expect(signalOwnedDarwinProcesses(seen, "SIGTERM", { tracker: t, kill, runPs: table.runPs })).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("keeps an immature identity unverified once its own proof is gone", () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 101, ppid: 100, pgid: 1, start: lstart(NOW) }]);
    const t = tracker();
    scanDarwinOwnership(t, { runPs: table.runPs });
    table.remove(100);
    table.update(101, { ppid: 1 });
    expect(scanDarwinOwnership(t, { runPs: table.runPs }).map((p) => [p.pid, p.via, p.verified])).toEqual([[101, "immature-identity", false]]);
  });

  it("fails closed when the wall clock steps backwards", () => {
    let wall = NOW;
    const t = tracker({ wall: () => wall, mono: () => 0 });
    const table = fakeTable([{ pid: 100, token: owner }]);
    scanDarwinOwnership(t, { runPs: table.runPs });
    wall = NOW - 2000;
    expect(() => scanDarwinOwnership(t, { runPs: table.runPs })).toThrow(/stepped backwards/);
  });
});

describe("darwin cleanup", () => {
  const probe = async () => false;
  const base = { port: 4000, procRoot: missingProc, platform: "darwin", euid, probe, pollMs: 1, clock: fixedClock() };

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
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 101, ppid: 100, pgid: 100 }, { pid: 300, argv: `grep ${marker}` }, { pid: 200, token: other }]);
    const kill = vi.fn((target, signal) => {
      if (target === -100 && signal === "SIGTERM") { table.remove(100); table.remove(101); }
    });
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, termMs: 200, runPs: table.runPs });
    expect(result).toMatchObject({ ok: true, survivors: [] });
    expect(killLog(kill)).toEqual(["-100:SIGTERM"]);
  });

  // Review repro 2, end to end: the old code rebuilt ownership per scan and
  // reported success here.
  it("does not report success while an observed orphaned descendant lives", async () => {
    const table = fakeTable([{ pid: 101, pgid: 101, token: owner }, { pid: 102, ppid: 101, pgid: 101 }], {
      onCall: (t) => {
        // After the first full scan, the token carrier exits and 102 is
        // reparented to launchd, tokenless, ignoring signals.
        if (t.calls.length === 4) {
          t.remove(101);
          t.update(102, { ppid: 1 });
        }
      },
    });
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, termMs: 5, killMs: 5, runPs: table.runPs });
    expect(result.ok).toBe(false);
    expect(result.survivors).toEqual([102]);
    expect(killLog(kill)).toEqual(["102:SIGTERM", "102:SIGKILL"]);
  });

  it("does not report success while an unverifiable group member lives, and never signals it", async () => {
    const table = fakeTable([{ pid: 101, token: owner }], {
      onCall: (t) => {
        if (t.calls.length === 4) {
          t.remove(101);
          t.add({ pid: 105, ppid: 1, pgid: 101 });
        }
      },
    });
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, termMs: 5, killMs: 5, runPs: table.runPs });
    expect(result.ok).toBe(false);
    expect(result.survivors).toEqual([105]);
    expect(result.reason).toMatch(/not signalled, ownership not verifiable: 105/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("reports a live owned descendant that survives SIGTERM and SIGKILL", async () => {
    const table = fakeTable([{ pid: 101, ppid: 1, pgid: 101, token: owner }, { pid: 102, ppid: 101, pgid: 101 }]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, selfExitMs: 5, termMs: 5, killMs: 5, runPs: table.runPs });
    expect(result.ok).toBe(false);
    expect(result.survivors).toEqual([101, 102]);
    expect(result.reason).toMatch(/survived cleanup: 101, 102/);
    // The group signal covers 102; it is never signalled on its own.
    expect(killLog(kill)).toEqual(["-101:SIGTERM", "-101:SIGKILL"]);
  });

  it("waits for a young owned process to mature before signalling it", async () => {
    const t0 = Date.now();
    const clock = { wall: () => NOW + (Date.now() - t0), mono: () => performance.now() };
    const table = fakeTable([{ pid: 100, token: owner, start: lstart(NOW) }, { pid: 300 }]);
    const kill = vi.fn((target) => { if (target === -100) table.remove(100); });
    const result = await cleanupShardServer({ ...base, owner, kill, clock, selfExitMs: 5, termMs: 500, pollMs: 20, runPs: table.runPs });
    expect(result).toMatchObject({ ok: true, survivors: [] });
    expect(killLog(kill)).toEqual(["-100:SIGTERM"]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
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
    const table = fakeTable([{ pid: 300, uid: process.geteuid() }]);
    const result = await cleanupShardServer({ ...base, owner, stateFile, euid: process.geteuid(), selfExitMs: 5, runPs: table.runPs });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});

describe.skipIf(process.platform !== "darwin")("darwin host process table", () => {
  const spawnNode = (script, env) => spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH, ...env } });
  const waitFor = async (check) => {
    const deadline = Date.now() + 10_000;
    while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it("cleans up a real owned tree, including a tokenless child, and leaves unrelated processes alone", async () => {
    const token = newShardOwnerToken();
    const tokenMarker = `${SHARD_OWNER_ENV}=${token}`;
    const port = await reserveLoopbackPort();
    // The owned leader listens and starts a tokenless child in its own group,
    // which keeps running after the leader exits.
    const leader = `
      const { spawn } = require("node:child_process");
      const env = { ...process.env }; delete env.${SHARD_OWNER_ENV};
      const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env });
      require("node:fs").writeFileSync(process.argv[1], String(c.pid));
      require("node:net").createServer().listen(${port}, "127.0.0.1");
      setInterval(() => {}, 1000);`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shard-darwin-host-"));
    tempDirs.push(dir);
    const childFile = path.join(dir, "child.pid");
    const owned = spawn(process.execPath, ["-e", leader, childFile], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH, [SHARD_OWNER_ENV]: token } });
    // Unrelated: the token in its arguments only, and a plain process.
    const decoy = spawnNode("setInterval(() => {}, 1000)", {});
    const argvDecoy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", tokenMarker], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH } });
    tracked.push(owned.pid, decoy.pid, argvDecoy.pid);
    await waitFor(() => fs.existsSync(childFile) && fs.readFileSync(childFile, "utf8") !== "");
    const childPid = Number(fs.readFileSync(childFile, "utf8"));
    tracked.push(childPid);

    const t = createDarwinOwnershipTracker(token);
    await waitFor(() => scanDarwinOwnership(t).length === 2);
    expect(scanDarwinOwnership(t).map((p) => [p.pid, p.verified])).toEqual([[owned.pid, true], [childPid, true]].sort((a, b) => a[0] - b[0]));

    const result = await cleanupShardServer({ owner: token, port, selfExitMs: 1_500, termMs: 5_000, killMs: 5_000 });
    expect(result).toMatchObject({ ok: true, verification: "darwin-ps", survivors: [] });
    expect(() => process.kill(owned.pid, 0)).toThrow();
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(() => process.kill(decoy.pid, 0)).not.toThrow();
    expect(() => process.kill(argvDecoy.pid, 0)).not.toThrow();
  });
});
