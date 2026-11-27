// Synthetic-procfs coverage for #2684: browser-shard cleanup must tell a
// demonstrably exited PID apart from a live PID whose identity cannot be read,
// fail closed on ownership uncertainty, and fail (without signalling) when an
// unattributed listener holds the shard port.
//
// Everything runs against a private fake /proc tree. `kill` and the port
// `probe` are mocks; no real process is signalled and no socket is opened.
// File errors (EACCES, ESRCH...) are injected through `readFile`, so results
// do not depend on the uid running the suite.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHARD_OWNER_ENV,
  classifyProcess,
  cleanupShardServer,
  readProcessIdentity,
  scanShardProcesses,
  signalOwnedProcesses,
  snapshotShardBaseline,
} from "../../scripts/lib/website-shard-server.mjs";

const euid = 1000;
const owner = "f".repeat(32);
const tempDirs = [];
const PF_KTHREAD = 0x00200000;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const codeError = (code) => Object.assign(new Error(code), { code });

function fakeProc(processes = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shard-procfs-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "self"));
  fs.writeFileSync(path.join(root, "self", "stat"), "1 (self) S 0 1 1");
  // pid -> { file: code | (() => void) } injected per read.
  const faults = new Map();
  const write = (pid, {
    token = null, env = ["PATH=/usr/bin"], uid = euid, uids = [uid, uid, uid, uid], startTime = "100",
    pgid = pid, state = "S", flags = 0, cmdline = "node\0server.js", stat, status,
  } = {}) => {
    const dir = path.join(root, String(pid));
    fs.mkdirSync(dir, { recursive: true });
    const fields = [state, "1", String(pgid), "0", "0", "0", String(flags), ...Array(12).fill("0"), startTime];
    fs.writeFileSync(path.join(dir, "stat"), stat ?? `${pid} (node (srv)) ${fields.join(" ")}`);
    fs.writeFileSync(path.join(dir, "status"), status ?? `Name:\tnode\nUid:\t${uids.join("\t")}\n`);
    const vars = token ? [...env, `${SHARD_OWNER_ENV}=${token}`] : env;
    fs.writeFileSync(path.join(dir, "environ"), vars.length ? `${vars.join("\0")}\0` : "");
    fs.writeFileSync(path.join(dir, "cmdline"), cmdline);
  };
  for (const [pid, spec] of Object.entries(processes)) write(Number(pid), spec);
  const readFile = (file, encoding) => {
    const pid = Number(path.basename(path.dirname(file)));
    const fault = faults.get(pid)?.[path.basename(file)];
    if (typeof fault === "string") throw codeError(fault);
    if (typeof fault === "function") fault();
    return fs.readFileSync(file, encoding);
  };
  return {
    root,
    write,
    readFile,
    fault: (pid, spec) => faults.set(pid, { ...faults.get(pid), ...spec }),
    clearFaults: (pid) => faults.delete(pid),
    remove: (pid) => fs.rmSync(path.join(root, String(pid)), { recursive: true, force: true }),
  };
}

const classify = (proc, pid, token = owner) =>
  classifyProcess(readProcessIdentity(pid, proc.root, { readFile: proc.readFile }), token, euid);

const fast = { selfExitMs: 30, termMs: 30, killMs: 30, listenerGraceMs: 30, pollMs: 5 };
const cleanup = (proc, extra = {}) => cleanupShardServer({
  owner, port: 4000, stateFile: path.join(proc.root, "state.json"), procRoot: proc.root, euid, selfPid: 0,
  readFile: proc.readFile, probe: async () => false, ...fast, ...extra,
});

describe("identity classification", () => {
  it("treats ENOENT, ESRCH, zombies and dead tasks as exited", () => {
    const proc = fakeProc({ 10: { token: owner }, 11: { token: owner, state: "Z" }, 12: { token: owner, state: "X" }, 13: { token: owner } });
    proc.remove(10);
    proc.fault(13, { status: "ESRCH" });
    expect(classify(proc, 10).verdict).toBe("gone");
    expect(classify(proc, 11).verdict).toBe("gone");
    expect(classify(proc, 12).verdict).toBe("gone");
    expect(classify(proc, 13).verdict).toBe("gone");
  });

  it("treats a process that exits between the status and environ reads as exited", () => {
    const proc = fakeProc({ 20: { token: owner } });
    proc.fault(20, { environ: () => proc.remove(20) });
    expect(classify(proc, 20).verdict).toBe("gone");

    // Became a zombie after environ was read (Linux returns an empty environ then).
    const proc2 = fakeProc({ 21: { token: owner } });
    proc2.fault(21, { environ: () => proc2.write(21, { env: [], state: "Z" }) });
    expect(classify(proc2, 21).verdict).toBe("gone");
  });

  it("keeps a live same-uid process with an unreadable environ uncertain, not exited", () => {
    const proc = fakeProc({ 30: { token: owner }, 31: {}, 32: { token: owner } });
    proc.fault(30, { environ: "EACCES" });
    proc.fault(31, { environ: "EPERM" });
    proc.fault(32, { environ: "EIO" });
    expect(classify(proc, 30)).toMatchObject({ verdict: "uncertain", reason: "environ EACCES", startTime: "100" });
    expect(classify(proc, 31)).toMatchObject({ verdict: "uncertain", reason: "environ EPERM" });
    expect(classify(proc, 32)).toMatchObject({ verdict: "uncertain", reason: "environ EIO" });
  });

  it("keeps unreadable or malformed stat and status uncertain for a possibly relevant process", () => {
    const proc = fakeProc({
      40: { token: owner, stat: "garbage without a paren" },
      41: { token: owner, status: "Name:\tnode\n" },
      42: { token: owner, status: "Uid:\t1000\tx\t1000\t1000\n" },
      43: { token: owner },
      44: { token: owner },
    });
    proc.fault(43, { stat: "EACCES" });
    proc.fault(44, { status: "EACCES" });
    expect(classify(proc, 40)).toMatchObject({ verdict: "uncertain", reason: "stat malformed" });
    expect(classify(proc, 41)).toMatchObject({ verdict: "uncertain", reason: "status malformed" });
    expect(classify(proc, 42)).toMatchObject({ verdict: "uncertain", reason: "status malformed" });
    expect(classify(proc, 43)).toMatchObject({ verdict: "uncertain", reason: "stat EACCES" });
    // With status unreadable, /proc/<pid>'s owner is the task's euid, or root
    // for a non-dumpable task: only a third uid proves the process foreign.
    const dirUid = fs.statSync(path.join(proc.root, "44")).uid;
    expect(classify(proc, 44).verdict).toBe(dirUid === euid || dirUid === 0 ? "uncertain" : "foreign");
    const read44 = readProcessIdentity(44, proc.root, { readFile: proc.readFile });
    expect(classifyProcess({ ...read44, dirUid: 1001, environ: ["PATH=/usr/bin"] }, owner, euid).verdict).toBe("foreign");
    // ...unless this shard's token is visible: then it stays uncertain.
    expect(classifyProcess({ ...read44, dirUid: 1001 }, owner, euid)).toMatchObject({ verdict: "uncertain", tokenSeen: true });
  });

  it("classifies other uids as foreign even when their environ is protected", () => {
    const proc = fakeProc({ 50: { uid: 0 }, 51: { uid: 1001 }, 52: { uid: 1001, stat: "broken" } });
    proc.fault(50, { environ: "EACCES" });
    proc.fault(51, { environ: "EACCES" });
    expect(classify(proc, 50)).toMatchObject({ verdict: "foreign", reason: "another uid" });
    expect(classify(proc, 51)).toMatchObject({ verdict: "foreign", reason: "another uid" });
    expect(classify(proc, 52)).toMatchObject({ verdict: "foreign", reason: "another uid" });
  });

  it("keeps this shard's token under another or changed uid uncertain instead of owned or foreign", () => {
    const proc = fakeProc({ 60: { token: owner, uid: 1001 }, 61: { token: owner, uids: [euid, 0, 0, 0] } });
    expect(classify(proc, 60)).toMatchObject({ verdict: "uncertain", tokenSeen: true });
    expect(classify(proc, 61)).toMatchObject({ verdict: "uncertain", reason: /changed credentials/ });
  });

  it("never takes a token in argv as ownership", () => {
    const proc = fakeProc({ 70: { cmdline: `node\0--owner\0${SHARD_OWNER_ENV}=${owner}`, env: ["PATH=/usr/bin", `X=${owner}`] } });
    expect(classify(proc, 70)).toMatchObject({ verdict: "foreign", reason: "no shard token" });
  });

  it("accepts only an exact token in a complete same-uid identity as owned", () => {
    const proc = fakeProc({ 80: { token: owner, pgid: 80 }, 81: { token: "e".repeat(32) }, 82: { env: [`${SHARD_OWNER_ENV}=${owner}x`] } });
    expect(classify(proc, 80)).toMatchObject({ verdict: "owned", identity: { pid: 80, pgid: 80, startTime: "100", uid: euid } });
    expect(classify(proc, 81).verdict).toBe("foreign");
    expect(classify(proc, 82).verdict).toBe("foreign");
  });

  it("separates kernel threads from live user processes with an empty environment", () => {
    const proc = fakeProc({ 90: { uid: euid, env: [], flags: PF_KTHREAD }, 91: { env: [] } });
    expect(classify(proc, 90)).toMatchObject({ verdict: "foreign", reason: "kernel thread" });
    expect(classify(proc, 91)).toMatchObject({ verdict: "uncertain", reason: "empty environment" });
  });

  it("re-reads a PID recycled mid-read and reports one that keeps changing as uncertain", () => {
    const proc = fakeProc({ 100: { startTime: "500" } });
    // First pass: an unrelated program is replaced by an owned one between reads.
    let swaps = 0;
    proc.fault(100, { environ: () => { if (!swaps++) proc.write(100, { token: owner, startTime: "501" }); } });
    expect(classify(proc, 100)).toMatchObject({ verdict: "owned", identity: { startTime: "501" } });

    let n = 600;
    proc.fault(100, { environ: () => proc.write(100, { token: owner, startTime: String(n++) }) });
    expect(classify(proc, 100)).toMatchObject({ verdict: "uncertain", reason: /changed while it was read/ });
  });

  it("never considers PID 1 or invalid PIDs", () => {
    const proc = fakeProc({ 1: { token: owner } });
    expect(classify(proc, 1).verdict).toBe("foreign");
    expect(readProcessIdentity(Number.NaN, proc.root).kind).toBe("excluded");
  });
});

describe("cleanup fails closed on uncertainty", () => {
  it("fails for a live owner whose environ is unreadable, and signals nothing", async () => {
    const proc = fakeProc({ 200: { token: owner, pgid: 200 } });
    proc.fault(200, { environ: "EACCES" });
    const kill = vi.fn();
    const result = await cleanup(proc, { kill });
    expect(result).toMatchObject({ ok: false, signalled: [], survivors: [], uncertain: [{ pid: 200, startTime: "100", reason: "environ EACCES" }] });
    expect(result.reason).toMatch(/ownership of live processes cannot be established.*200 \(environ EACCES\)/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("passes when a briefly unreadable process exits normally during the wait", async () => {
    const proc = fakeProc({ 210: { token: owner } });
    proc.fault(210, { environ: "EACCES" });
    setTimeout(() => proc.remove(210), 5);
    const kill = vi.fn();
    const result = await cleanup(proc, { kill, selfExitMs: 1_000 });
    expect(result).toMatchObject({ ok: true, uncertain: [], signalled: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails for an unattributed listener, keeps the state file and signals nothing", async () => {
    const proc = fakeProc({ 220: { uid: 0 }, 221: { token: "e".repeat(32) } });
    const stateFile = path.join(proc.root, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify({ owner, port: 4000 }), { mode: 0o600 });
    const kill = vi.fn();
    const probe = vi.fn(async () => true);
    const result = await cleanup(proc, { kill, probe, stateFile });
    expect(result).toMatchObject({ ok: false, unattributedListener: true, signalled: [], survivors: [], uncertain: [] });
    expect(result.reason).toMatch(/unattributed listener still holds shard port 4000; it was not signalled/);
    expect(probe).toHaveBeenCalledWith("127.0.0.1", 4000);
    expect(kill).not.toHaveBeenCalled();
    expect(fs.existsSync(stateFile)).toBe(true);
  });

  it("allows a listener that releases the port within the grace period", async () => {
    const proc = fakeProc();
    let answers = 3;
    const result = await cleanup(proc, { probe: async () => answers-- > 0, listenerGraceMs: 1_000 });
    expect(result).toMatchObject({ ok: true, unattributedListener: false });
  });

  it("treats a probe that throws as a held port", async () => {
    const proc = fakeProc();
    const result = await cleanup(proc, { probe: async () => { throw new Error("probe broke"); } });
    expect(result).toMatchObject({ ok: false, unattributedListener: true });
  });

  it("fails when a shard process appears after the port check", async () => {
    const proc = fakeProc();
    const kill = vi.fn();
    const probe = vi.fn(async () => { proc.write(230, { token: owner }); return false; });
    const result = await cleanup(proc, { kill, probe });
    expect(result).toMatchObject({ ok: false, survivors: [230] });
    expect(result.reason).toMatch(/appeared after the port check/);
    expect(kill).not.toHaveBeenCalled();
  });

  it("ignores other users' protected processes and kernel threads", async () => {
    const proc = fakeProc({ 240: { uid: 0 }, 241: { uid: 1001 }, 242: { uid: 0, env: [], flags: PF_KTHREAD } });
    proc.fault(240, { environ: "EACCES" });
    proc.fault(241, { environ: "EACCES" });
    const kill = vi.fn();
    expect(await cleanup(proc, { kill })).toMatchObject({ ok: true, uncertain: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("treats owned zombies as exited without signalling them", async () => {
    const proc = fakeProc({ 250: { token: owner, state: "Z" } });
    const kill = vi.fn();
    expect(await cleanup(proc, { kill })).toMatchObject({ ok: true, signalled: [] });
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not signal an owned process that becomes unreadable before the signal", () => {
    const proc = fakeProc({ 260: { token: owner, pgid: 260 } });
    const seen = scanShardProcesses(owner, { procRoot: proc.root, euid, selfPid: 0, readFile: proc.readFile }).owned;
    expect(seen.map((p) => p.pid)).toEqual([260]);
    proc.fault(260, { environ: "EACCES" });
    const kill = vi.fn();
    expect(signalOwnedProcesses(seen, "SIGTERM", { owner, procRoot: proc.root, euid, kill, readFile: proc.readFile })).toEqual([]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("signals the owned process, then fails on an uncertain one that outlives it", async () => {
    const proc = fakeProc({ 270: { token: owner, pgid: 270 }, 271: { token: owner, pgid: 270 } });
    proc.fault(271, { environ: "EACCES" });
    const kill = vi.fn((target) => { if (target === -270) proc.remove(270); });
    const result = await cleanup(proc, { kill });
    expect(kill.mock.calls).toEqual([[-270, "SIGTERM"]]);
    expect(result).toMatchObject({ ok: false, survivors: [], uncertain: [{ pid: 271 }] });
  });
});

describe("pre-shard baseline", () => {
  it("excludes only unreadable processes that predate the shard with the same start time", async () => {
    const proc = fakeProc({ 300: { startTime: "10" }, 301: { uid: 1001 } });
    proc.fault(300, { environ: "EACCES" });
    const baseline = snapshotShardBaseline({ procRoot: proc.root, euid, selfPid: 0, readFile: proc.readFile });
    expect(baseline).toEqual(["300:10"]);

    // The same agent is still running: cleanup passes.
    expect(await cleanup(proc, { baseline })).toMatchObject({ ok: true, uncertain: [] });

    // PID 300 was recycled into a new unreadable process: no longer excluded.
    proc.write(300, { startTime: "11" });
    const recycled = await cleanup(proc, { baseline });
    expect(recycled).toMatchObject({ ok: false, uncertain: [{ pid: 300, startTime: "11" }] });

    // A token seen under another uid is never excused by the baseline.
    proc.write(302, { token: owner, uid: 1001 });
    const seen = scanShardProcesses(owner, { procRoot: proc.root, euid, selfPid: 0, readFile: proc.readFile, baseline: ["302:100"] });
    expect(seen.uncertain.map((entry) => entry.pid)).toEqual([300, 302]);
  });

  it("returns no baseline without procfs or when enumeration fails", () => {
    expect(snapshotShardBaseline({ procRoot: path.join(os.tmpdir(), "durindoor-no-proc-here") })).toBeNull();
    const proc = fakeProc();
    expect(snapshotShardBaseline({ procRoot: proc.root, readDirectory: () => { throw codeError("EACCES"); } })).toBeNull();
  });
});
