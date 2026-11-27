// macOS cleanup for website browser shards: observe, never signal.
//
// macOS has no /proc, and `ps -E` cannot prove that the owner token is an
// environment variable rather than argument text, so cleanup on macOS sends
// no signal at all. It only waits, and it reports success only when a
// conservative scan finds nothing that may belong to the shard and the port
// is free. These tests run on every platform: the process table is injected
// and `kill` is a mock that must never be called. The last block runs only
// on a real macOS host and signals only children this test spawned.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DARWIN_PS,
  DARWIN_PS_ARGS,
  DARWIN_PS_ENV,
  SHARD_OWNER_ENV,
  cleanupShardServer,
  createDarwinTracker,
  findOwnedDarwinProcesses,
  newShardOwnerToken,
  ownershipSource,
  parseDarwinProcessTable,
  reserveLoopbackPort,
  runDarwinPs,
  scanDarwinProcesses,
} from "../../scripts/lib/website-shard-server.mjs";

const owner = "e".repeat(32);
const other = "f".repeat(32);
const marker = `${SHARD_OWNER_ENV}=${owner}`;
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

// One `ps -axww -E -o pid=,ppid=,uid=,pgid=,stat=,lstart=,command=` line,
// padded the way macOS pads lstart: arguments, then environment.
const line = ({ pid, ppid = 1, uid = euid, pgid = pid, stat = "S", start = START, argv = "node server.js", env = ["PATH=/usr/bin"], token }) =>
  `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(uid).padStart(5)} ${String(pgid).padStart(5)} ${stat.padEnd(4)} ${start}    ${argv} ${[...env, ...(token ? [`${SHARD_OWNER_ENV}=${token}`] : [])].join(" ")}`.trimEnd();

// A mutable fake process table served through the injected ps runner.
function fakeTable(rows, { onCall } = {}) {
  const table = { rows: [...rows], calls: 0 };
  table.runPs = () => {
    table.calls += 1;
    onCall?.(table);
    return { stdout: `${table.rows.map(line).join("\n")}\n`, pid: 99_999 };
  };
  table.remove = (pid) => { table.rows = table.rows.filter((r) => r.pid !== pid); };
  table.add = (r) => { table.rows.push(r); };
  table.update = (pid, patch) => { table.rows = table.rows.map((r) => (r.pid === pid ? { ...r, ...patch } : r)); };
  return table;
}

const tracker = () => createDarwinTracker(owner, { selfPid: 4242 });
const scanPids = (t, table) => scanDarwinProcesses(t, { runPs: table.runPs }).map((p) => p.pid);

describe("darwin process table parsing", () => {
  it("parses pid, parent, uid, group, state, UTC start time and command", () => {
    const table = parseDarwinProcessTable(line({ pid: 700, ppid: 600, pgid: 650, stat: "Ss", start: "Sat Nov  7 01:02:03 2026", argv: "node a.js", env: [] }));
    expect(table.get(700)).toMatchObject({ pid: 700, ppid: 600, uid: euid, pgid: 650, state: "Ss", startSec: Date.UTC(2026, 10, 7, 1, 2, 3) / 1000, command: "node a.js" });
  });

  it("fails closed on empty output, unparseable lines, malformed start times and duplicate PIDs", () => {
    expect(() => parseDarwinProcessTable("")).toThrow(/empty process table/);
    expect(() => parseDarwinProcessTable(`${line({ pid: 700 })}\ngarbage line\n`)).toThrow(/unparseable ps line/);
    for (const start of ["Fri Feb 31 05:14:59 2026", "Fri Nov 27 05:61:00 2026", "Fri Nov 27 24:00:00 2026", "Fri Nov 27 05:14:60 2026", "Fri Abc 27 05:14:59 2026"]) {
      expect(() => parseDarwinProcessTable(line({ pid: 700, start }))).toThrow(/start time|unparseable/);
    }
    expect(() => parseDarwinProcessTable(`${line({ pid: 700 })}\n${line({ pid: 700, argv: "forged" })}\n`)).toThrow(/PID 700 twice/);
  });

  it("runs /bin/ps -E with UTC, a fixed locale, a minimal environment and a timeout", () => {
    const spawn = vi.fn(() => ({ status: 0, signal: null, stdout: line({ pid: 700 }), pid: 42 }));
    expect(runDarwinPs({ spawn })).toEqual({ stdout: line({ pid: 700 }), pid: 42 });
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(DARWIN_PS);
    expect(args).toEqual(DARWIN_PS_ARGS);
    expect(args).toContain("-E");
    expect(options.env).toEqual({ ...DARWIN_PS_ENV });
    expect(options.env.TZ).toBe("UTC0");
    expect(options.env[SHARD_OWNER_ENV]).toBeUndefined();
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("turns ps spawn errors, signals and non-zero exits into enumeration errors", () => {
    const run = (result) => () => runDarwinPs({ spawn: () => result });
    expect(run({ error: Object.assign(new Error("nope"), { code: "ENOENT" }) })).toThrow(/ps ENOENT/);
    expect(run({ status: null, signal: "SIGTERM", stdout: "" })).toThrow(/terminated by SIGTERM/);
    expect(run({ status: 1, signal: null, stdout: "" })).toThrow(/exited with status 1/);
  });
});

describe("darwin observation", () => {
  it("selects ps on macOS without procfs, and nothing on Linux without procfs", () => {
    expect(ownershipSource({ procRoot: missingProc, platform: "darwin" })).toBe("darwin-ps");
    expect(ownershipSource({ procRoot: missingProc, platform: "linux" })).toBeNull();
    expect(ownershipSource({ procRoot: missingProc, platform: "freebsd" })).toBeNull();
  });

  it("counts token text anywhere, descendants and group members, and nothing unrelated", () => {
    const table = fakeTable([
      { pid: 100, token: owner }, // launcher
      { pid: 101, ppid: 100, pgid: 100, env: [] }, // tokenless child
      { pid: 102, ppid: 101, pgid: 100 }, // grandchild
      { pid: 103, ppid: 1, pgid: 100 }, // orphan in the launcher's group
      { pid: 104, ppid: 101, pgid: 104, uid: 0 }, // child under another uid: still counted
      { pid: 200, token: other }, // another shard
      { pid: 201, ppid: 200 }, // its child
      { pid: 300 }, // unrelated, same uid
      { pid: 500, stat: "Z", token: owner }, // zombie
      { pid: 600, env: [`${marker}x`] }, // near-miss word
      { pid: 4242, token: owner }, // this runner (excluded)
      { pid: 99_999, token: owner }, // the ps process (excluded)
    ]);
    const found = scanDarwinProcesses(tracker(), { runPs: table.runPs });
    expect(found.map((p) => [p.pid, p.via])).toEqual([[100, "token-text"], [101, "descendant"], [102, "descendant"], [103, "group"], [104, "descendant"]]);
  });

  it("findOwnedDarwinProcesses runs one scan with a fresh tracker", () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 300 }]);
    expect(findOwnedDarwinProcesses(owner, { selfPid: 4242, runPs: table.runPs }).map((p) => p.pid)).toEqual([100]);
    expect(table.calls).toBe(1);
  });

  // Review repro: an observed tokenless descendant orphaned by its parent.
  it("keeps counting an observed orphan after its parent, title and group are gone", () => {
    const table = fakeTable([{ pid: 101, token: owner }, { pid: 102, ppid: 101, pgid: 101, env: [] }, { pid: 300 }]);
    const t = tracker();
    expect(scanPids(t, table)).toEqual([101, 102]);
    table.remove(101);
    table.update(102, { ppid: 1, pgid: 102, argv: "renamed" });
    expect(scanDarwinProcesses(t, { runPs: table.runPs }).map((p) => [p.pid, p.via])).toEqual([[102, "seen-before"]]);
    // A recycled PID 102 (new start time) in another group is a different
    // process. (Leading group 102, which the orphan led, it would still be
    // counted: over-counting only makes cleanup fail.)
    table.remove(102);
    table.add({ pid: 102, pgid: 777, start: "Fri Nov 27 06:00:00 2026" });
    expect(scanPids(t, table)).toEqual([]);
    table.update(102, { pgid: 102 });
    expect(scanPids(t, table)).toEqual([102]);
  });

  it("keeps counting a never-seen member of a group the launcher once led", () => {
    const table = fakeTable([{ pid: 101, token: owner }, { pid: 300 }]);
    const t = tracker();
    scanPids(t, table);
    table.remove(101);
    table.add({ pid: 105, ppid: 1, pgid: 101, env: [] });
    table.add({ pid: 106, ppid: 105, pgid: 106, env: [] });
    expect(scanPids(t, table)).toEqual([105, 106]);
    table.remove(105);
    table.update(106, { ppid: 1 });
    expect(scanPids(t, table)).toEqual([106]);
  });
});

describe("darwin cleanup never signals", () => {
  const base = { port: 4000, procRoot: missingProc, platform: "darwin", euid, pollMs: 1, selfExitMs: 5, termMs: 5, killMs: 5 };
  const free = async () => false;

  it("fails closed when the process table cannot be enumerated, even with a free port", async () => {
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, runPs: () => { throw new Error("cannot enumerate owned processes: ps exited with status 1"); } });
    expect(result).toMatchObject({ ok: false, verification: "darwin-ps", signalled: [] });
    expect(result.reason).toMatch(/ps exited with status 1/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails closed on an unparseable table", async () => {
    const result = await cleanupShardServer({ ...base, owner, kill: vi.fn(), probe: free, runPs: () => ({ stdout: "nonsense\n", pid: 1 }) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unparseable/);
  });

  it("succeeds once the launcher's tree has exited on its own and the port is free", async () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 101, ppid: 100, pgid: 100 }, { pid: 300 }, { pid: 200, token: other }], {
      onCall: (t) => { if (t.calls === 3) { t.remove(100); t.remove(101); } },
    });
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, selfExitMs: 1_000, runPs: table.runPs });
    expect(result).toMatchObject({ ok: true, verification: "darwin-ps", signalled: [], survivors: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails, without signalling, while a shard process keeps running", async () => {
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 101, ppid: 100, pgid: 100 }, { pid: 300 }]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, runPs: table.runPs });
    expect(result).toMatchObject({ ok: false, signalled: [], survivors: [100, 101] });
    expect(result.reason).toMatch(/never signals/);
    expect(kill).not.toHaveBeenCalled();
  });

  // Review repro: the token only in an unrelated process's arguments.
  it("never signals a process with the token in its arguments; it only blocks success", async () => {
    const table = fakeTable([{ pid: 300, argv: `grep ${marker}` }, { pid: 301 }]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, runPs: table.runPs });
    expect(result).toMatchObject({ ok: false, survivors: [300] });
    expect(kill).not.toHaveBeenCalled();
  });

  // Review repro: arguments flip to carry the token only during one read.
  it("never signals a process whose arguments flip to the token text mid-read", async () => {
    let n = 0;
    const table = fakeTable([{ pid: 300, pgid: 300 }, { pid: 301, ppid: 300, pgid: 300 }, { pid: 302 }], {
      onCall: (t) => { n += 1; t.update(300, { argv: n % 2 ? `node server ${marker}` : "node server" }); },
    });
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, runPs: table.runPs });
    expect(result.ok).toBe(false);
    expect(result.signalled).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  // Review repro: a genuine shard process whose title changes between reads
  // must not vanish and let cleanup report success.
  it("does not report success while an observed shard process changes its title", async () => {
    let n = 0;
    const table = fakeTable([{ pid: 100, token: owner }, { pid: 300 }], {
      onCall: (t) => { n += 1; t.update(100, { argv: `next-server (v${n})` }); },
    });
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, runPs: table.runPs });
    expect(result).toMatchObject({ ok: false, survivors: [100] });
    expect(kill).not.toHaveBeenCalled();
  });

  // Review repro: a recycled PID can never be signalled, because no signal
  // is ever sent; an observed orphan only keeps cleanup from succeeding.
  it("reports an observed orphan that outlives its parent, and never signals it", async () => {
    const table = fakeTable([{ pid: 101, token: owner }, { pid: 102, ppid: 101, pgid: 101, env: [] }, { pid: 300 }], {
      onCall: (t) => { if (t.calls === 2) { t.remove(101); t.update(102, { ppid: 1, pgid: 102 }); } },
    });
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: free, runPs: table.runPs });
    expect(result).toMatchObject({ ok: false, survivors: [102] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not call a held port foreign when its owner cannot be verified", async () => {
    const table = fakeTable([{ pid: 300 }]);
    const kill = vi.fn();
    const result = await cleanupShardServer({ ...base, owner, kill, probe: async () => true, runPs: table.runPs });
    expect(result).toMatchObject({ ok: false, foreignListener: false, signalled: [] });
    expect(result.reason).toMatch(/port is still held/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("removes this shard's state file only after a verified cleanup", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shard-darwin-"));
    tempDirs.push(dir);
    const stateFile = path.join(dir, "s.json");
    fs.writeFileSync(stateFile, JSON.stringify({ owner, port: 4000 }), { mode: 0o600 });
    const held = await cleanupShardServer({ ...base, owner, stateFile, euid: process.geteuid(), probe: free, runPs: fakeTable([{ pid: 100, token: owner }]).runPs });
    expect(held.ok).toBe(false);
    expect(fs.existsSync(stateFile)).toBe(true);
    const result = await cleanupShardServer({ ...base, owner, stateFile, euid: process.geteuid(), probe: free, runPs: fakeTable([{ pid: 300 }]).runPs });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(false);
  });
});

describe.skipIf(process.platform !== "darwin")("darwin host process table", () => {
  const waitFor = async (check, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it("observes a real tree without signalling it, then succeeds once it exits on its own", async () => {
    const token = newShardOwnerToken();
    const port = await reserveLoopbackPort();
    // An owned tree that listens, runs a tokenless child, and stops itself
    // (as the launcher's watchdog does) after three seconds.
    const leader = `
      const { spawn } = require("node:child_process");
      const env = { ...process.env }; delete env.${SHARD_OWNER_ENV};
      spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "ignore", env });
      require("node:net").createServer().listen(${port}, "127.0.0.1");
      setTimeout(() => process.exit(0), 3000);`;
    const owned = spawn(process.execPath, ["-e", leader], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH, [SHARD_OWNER_ENV]: token } });
    const decoy = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", `${SHARD_OWNER_ENV}=${newShardOwnerToken()}`], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH } });
    tracked.push(owned.pid, decoy.pid);
    const t = createDarwinTracker(token);
    await waitFor(() => scanDarwinProcesses(t).length >= 2);
    expect(scanDarwinProcesses(t).map((p) => p.pid)).toContain(owned.pid);

    const kill = vi.fn();
    const result = await cleanupShardServer({ owner: token, port, kill, selfExitMs: 8_000, termMs: 0, killMs: 0 });
    expect(result).toMatchObject({ ok: true, verification: "darwin-ps", signalled: [], survivors: [] });
    expect(kill).not.toHaveBeenCalled();
    expect(alive(owned.pid)).toBe(false);
    expect(alive(decoy.pid)).toBe(true);
  });

  it("fails without signalling while a real owned process keeps running", async () => {
    const token = newShardOwnerToken();
    const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", env: { PATH: process.env.PATH, [SHARD_OWNER_ENV]: token } });
    tracked.push(owned.pid);
    await waitFor(() => findOwnedDarwinProcesses(token).length === 1);
    const kill = vi.fn();
    const result = await cleanupShardServer({ owner: token, port: await reserveLoopbackPort(), kill, selfExitMs: 500, termMs: 0, killMs: 0 });
    expect(result).toMatchObject({ ok: false, signalled: [], survivors: [owned.pid] });
    expect(kill).not.toHaveBeenCalled();
    expect(alive(owned.pid)).toBe(true);
  });
});
