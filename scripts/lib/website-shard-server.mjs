// Lifecycle guard for the transient website server each browser shard starts.
//
// Why this exists: Playwright launches `webServer` in its own process group
// (`detached: true` on POSIX). When local-ci ends a shard by signalling the
// shard's group (300-second budget, silence watchdog, interrupt), the runner
// dies without its own cleanup and the server group keeps running, holding
// the shard's port for every later checkpoint.
//
// The guard keeps three promises:
//
//   * Isolation. Every shard gets its own available loopback port, its own
//     private state file and a random owner token. Nothing shares the old
//     fixed port 3100.
//   * Ownership. A process is signalled only when the kernel's process table
//     proves it belongs to this shard: same uid as this runner, the shard's
//     owner token in its environment (never just in its arguments), and an
//     unchanged kernel start time, re-read right before each signal. Linux
//     reads /proc. macOS has no /proc and separates environment from
//     arguments by comparing `ps` snapshots with and without `-E`; it also
//     tracks identities across scans (see "macOS ownership" below). A PID
//     that was reused by another program fails the token and start-time
//     checks. A listener without the token is never touched, even when it
//     holds the shard's port.
//   * Fail closed. When an owned process survives SIGTERM and SIGKILL, when
//     the kernel refuses a signal, or when ownership cannot be verified and
//     the port stays held, cleanup reports failure and local-ci stops the
//     remaining shards instead of starting the next one beside a leftover.
//
// The guard touches only the processes it proves it owns. It writes no unit,
// schedule or machine setting.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import { isString } from "../../src/shared/utils/typeChecks.js";

export const SHARD_SERVER_HOST = "127.0.0.1";
export const SHARD_OWNER_ENV = "WEBSITE_TRANSIENT_OWNER";
export const SHARD_PORT_ENV = "WEBSITE_TRANSIENT_PORT";
export const SHARD_STATE_ENV = "WEBSITE_TRANSIENT_STATE_FILE";
const OWNER_RE = /^[a-f0-9]{32}$/;

export function newShardOwnerToken() {
  return randomBytes(16).toString("hex");
}

export function isShardOwnerToken(value) {
  return isString(value) && OWNER_RE.test(value);
}

// Asks the kernel for a free loopback port. The caller reserves it right
// before the shard starts; if another program wins the race, the transient
// launcher refuses the occupied port and the shard fails instead of attaching.
export function reserveLoopbackPort(host = SHARD_SERVER_HOST) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function isPortListening(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

// Reads what the kernel says about one PID. Returns null when the process is
// gone, is a zombie (it cannot hold a socket), or cannot be read.
export function readProcessIdentity(pid, procRoot = "/proc") {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const dir = path.join(procRoot, String(pid));
  try {
    const stat = readFileSync(path.join(dir, "stat"), "utf8");
    // comm may contain spaces and parentheses; fields resume after the last ')'.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const state = fields[0];
    if (state === "Z" || state === "X") return null;
    const status = readFileSync(path.join(dir, "status"), "utf8");
    const uidLine = status.split("\n").find((line) => line.startsWith("Uid:"));
    const uid = uidLine ? Number(uidLine.split(/\s+/)[1]) : NaN;
    const environ = readFileSync(path.join(dir, "environ"), "utf8").split("\0");
    return {
      pid,
      state,
      pgid: Number(fields[2]),
      startTime: fields[19],
      uid,
      environ,
    };
  } catch {
    return null;
  }
}

export function processOwnedBy(identity, owner, euid) {
  return Boolean(identity)
    && isShardOwnerToken(owner)
    && identity.uid === euid
    && identity.environ.includes(`${SHARD_OWNER_ENV}=${owner}`);
}

export function procfsAvailable(procRoot = "/proc") {
  try {
    return existsSync(path.join(procRoot, "self", "stat"));
  } catch {
    return false;
  }
}

export function findOwnedProcesses(owner, { procRoot = "/proc", euid = process.geteuid(), selfPid = process.pid, readDirectory = readdirSync } = {}) {
  const owned = [];
  let entries;
  try {
    entries = readDirectory(procRoot);
  } catch (error) {
    throw new Error(`cannot enumerate owned processes: ${error.code || error.message}`);
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === selfPid) continue;
    const identity = readProcessIdentity(pid, procRoot);
    if (processOwnedBy(identity, owner, euid)) owned.push(identity);
  }
  return owned.sort((a, b) => a.pid - b.pid);
}

// The state file is a record, never proof: it is accepted (and removed after
// cleanup) only when it is a private regular file of this uid naming the same
// owner and port. Signalling decisions never rest on the PIDs it lists.
export function readShardServerState(stateFile, { owner, port, euid = process.geteuid() } = {}) {
  let info;
  try {
    info = lstatSync(stateFile);
  } catch {
    return { state: null, reason: "absent" };
  }
  if (!info.isFile() || info.isSymbolicLink()) return { state: null, reason: "not a regular file" };
  if (info.uid !== euid) return { state: null, reason: "owned by another user" };
  if (info.mode & 0o077) return { state: null, reason: "not private" };
  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return { state: null, reason: "unparseable" };
  }
  if (state?.owner !== owner) return { state: null, reason: "owner mismatch" };
  if (state?.port !== port) return { state: null, reason: "port mismatch" };
  return { state, reason: null };
}

// Signals only processes whose identity is re-read immediately before the
// signal and still matches the earlier scan: same token, uid and kernel start
// time. A recycled PID has a different start time and no token, so it is
// skipped. A verified group leader takes its group with it: POSIX systems
// (Linux and macOS) never hand out a PID while a live process still uses it as
// a process group ID, and the
// group was created by this shard's own launcher. ESRCH (already gone) is
// fine; any other refusal is thrown so the caller fails closed.
export function signalOwnedProcesses(processes, signal, { owner, procRoot = "/proc", euid = process.geteuid(), kill = process.kill.bind(process) } = {}) {
  const signalled = [];
  for (const seen of processes) {
    const now = readProcessIdentity(seen.pid, procRoot);
    if (!processOwnedBy(now, owner, euid) || now.startTime !== seen.startTime) continue;
    const target = now.pgid === now.pid ? -now.pid : now.pid;
    try {
      kill(target, signal);
      signalled.push({ pid: now.pid, group: target < 0, signal });
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  return signalled;
}

// macOS ownership
//
// macOS has no /proc and no stock tool that prints a process environment on
// its own. `/bin/ps -E` appends the environment to the arguments, so a
// single `ps -E` line cannot tell an argument that reads
// `WEBSITE_TRANSIENT_OWNER=<token>` from the real variable. Every scan
// therefore reads three snapshots of the whole table, all with `TZ=UTC0`,
// `LC_ALL=C`, a minimal PATH and no shard token:
//
//   1. arguments only (`ps -axww -o ...,command=`)
//   2. arguments plus environment (`ps -axww -E -o ...,command=`)
//   3. arguments only, again
//
// A process carries the token in its environment only when snapshots 1 and 3
// agree on its start time and arguments (so it did not exec in between), and
// snapshot 2 equals those arguments followed by an environment region that
// contains the exact `WEBSITE_TRANSIENT_OWNER=<token>` word. A token that is
// only in the arguments never reaches the environment region. The kernel
// serves the environment only to the same uid, the only uid this guard
// signals.
//
// Identity is PID plus `lstart`, which has one-second resolution. That is
// enough only for a process observed at least one full second (plus a clock
// margin) after it started: a recycled PID gets a start time at or after
// the moment the recycling happens, which is after the observation, so it
// cannot share the old start second. A younger process is "immature": it is
// tracked and keeps cleanup from succeeding, but is not signalled until it
// matures. A wall clock seen stepping backwards (wall minus monotonic time
// shrinking by more than the margin) voids that argument, and the scan fails.
//
// Ownership is kept across scans in a tracker, never rebuilt from scratch:
//
//   * a process is owned when it runs as this uid and proves the token in
//     its environment, matches a mature identity owned in an earlier scan,
//     descends (by ppid) from an owned process, or belongs to a process group
//     that an owned process led and that still holds an owned member;
//   * a live same-uid process in a group this shard once owned, that cannot
//     be proven owned now (for example an orphan in a group whose known
//     members are all gone), and an owned identity that is still immature or
//     changed uid are "unverified": never signalled, and cleanup fails while
//     they live.
//
// Every signal is preceded by a fresh `ps -p <pid>` read of that one PID
// that must still match the tracked mature identity. Members of a group
// already signalled in the same round are not signalled again. Any `ps`
// failure, timeout, empty table, duplicate PID or line that does not parse
// makes the scan throw, so cleanup fails closed.
export const DARWIN_PS = "/bin/ps";
const DARWIN_FIELDS = "pid=,ppid=,uid=,pgid=,stat=,lstart=,command=";
export const DARWIN_PS_ARGS = ["-axww", "-o", DARWIN_FIELDS];
export const DARWIN_PS_ENV_ARGS = ["-axww", "-E", "-o", DARWIN_FIELDS];
export const darwinPsPidArgs = (pid) => ["-ww", "-o", DARWIN_FIELDS, "-p", String(pid)];
export const DARWIN_PS_ENV = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC0" });
// Clock margin for start-time maturity and backward-step detection.
export const DARWIN_CLOCK_MARGIN_MS = 500;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DARWIN_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}) ([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})(?:\s+(.*))?$/;

export function runDarwinPs(args = DARWIN_PS_ARGS, { spawn = spawnSync, timeoutMs = 10_000 } = {}) {
  const result = spawn(DARWIN_PS, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    // No token, fixed locale and UTC start times, nothing inherited.
    env: { ...DARWIN_PS_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`cannot enumerate owned processes: ps ${result.error.code || result.error.message}`);
  if (result.signal) throw new Error(`cannot enumerate owned processes: ps terminated by ${result.signal}`);
  const stdout = String(result.stdout ?? "");
  // `ps -p` exits 1 with no output when the PID is gone; that is an answer.
  if (result.status === 1 && args.includes("-p") && stdout.trim() === "") return { stdout: "", pid: result.pid };
  if (result.status !== 0) throw new Error(`cannot enumerate owned processes: ps exited with status ${result.status}`);
  return { stdout, pid: result.pid };
}

function darwinStartSeconds(month, day, hh, mm, ss, year) {
  const m = MONTHS.indexOf(month);
  if (m < 0) return NaN;
  const ms = Date.UTC(Number(year), m, Number(day), Number(hh), Number(mm), Number(ss));
  const check = new Date(ms);
  if (check.getUTCDate() !== Number(day) || check.getUTCMonth() !== m) return NaN;
  return ms / 1000;
}

// Parses one snapshot into a Map keyed by PID. `allowEmpty` is for `ps -p`.
export function parseDarwinProcessTable(stdout, { allowEmpty = false } = {}) {
  const lines = String(stdout).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.every((line) => line.trim() === "")) {
    if (allowEmpty) return new Map();
    throw new Error("cannot enumerate owned processes: ps returned an empty process table");
  }
  const table = new Map();
  for (const line of lines) {
    const match = DARWIN_LINE_RE.exec(line);
    if (!match) throw new Error(`cannot enumerate owned processes: unparseable ps line: ${line.slice(0, 120)}`);
    const [, pid, ppid, uid, pgid, state, , month, day, hh, mm, ss, year, command = ""] = match;
    const startSec = darwinStartSeconds(month, day, hh, mm, ss, year);
    if (!Number.isFinite(startSec)) throw new Error(`cannot enumerate owned processes: unparseable ps start time: ${line.slice(0, 120)}`);
    const row = { pid: Number(pid), ppid: Number(ppid), uid: Number(uid), pgid: Number(pgid), state, startSec, startTime: String(startSec), command };
    if (table.has(row.pid)) throw new Error(`cannot enumerate owned processes: ps listed PID ${row.pid} twice`);
    table.set(row.pid, row);
  }
  return table;
}

// The environment words of one process, or null when they cannot be told
// apart from its arguments. `args`/`argsAgain` are the arguments-only rows
// read before and after `withEnv`.
export function darwinEnvironmentWords(args, withEnv, argsAgain) {
  if (!args || !withEnv || !argsAgain) return null;
  if (args.startSec !== withEnv.startSec || argsAgain.startSec !== withEnv.startSec) return null;
  if (args.command !== argsAgain.command) return null;
  if (withEnv.command === args.command) return [];
  if (!withEnv.command.startsWith(`${args.command} `)) return null;
  return withEnv.command.slice(args.command.length + 1).split(" ").filter(Boolean);
}

export function createDarwinOwnershipTracker(owner, { euid = process.geteuid(), selfPid = process.pid, clock = {} } = {}) {
  if (!isShardOwnerToken(owner)) throw new Error("invalid shard owner token");
  return {
    owner,
    euid,
    selfPid,
    wall: clock.wall ?? Date.now,
    mono: clock.mono ?? (() => performance.now()),
    // pid -> { pid, startSec, observedAt }
    identities: new Map(),
    // Process groups led by an owned process at some scan.
    groups: new Set(),
    clockOffset: null,
  };
}

const darwinMature = (tracker, identity) => (identity.startSec + 1) * 1000 + DARWIN_CLOCK_MARGIN_MS <= identity.observedAt;

function darwinCheckClock(tracker, wall, mono) {
  const offset = wall - mono;
  if (tracker.clockOffset !== null && offset < tracker.clockOffset - DARWIN_CLOCK_MARGIN_MS) {
    throw new Error("cannot verify process identity: the wall clock stepped backwards during cleanup");
  }
  tracker.clockOffset = tracker.clockOffset === null ? offset : Math.max(tracker.clockOffset, offset);
}

// One scan: reads the three snapshots, updates the tracker and returns every
// live process this shard owns or cannot rule out, sorted by PID. Entries
// with `verified: false` are never signalled.
export function scanDarwinOwnership(tracker, { runPs = runDarwinPs } = {}) {
  const wall = tracker.wall();
  darwinCheckClock(tracker, wall, tracker.mono());
  const first = runPs(DARWIN_PS_ARGS);
  const withEnv = runPs(DARWIN_PS_ENV_ARGS);
  const again = runPs(DARWIN_PS_ARGS);
  darwinCheckClock(tracker, tracker.wall(), tracker.mono());
  const argsTable = parseDarwinProcessTable(first.stdout);
  const envTable = parseDarwinProcessTable(withEnv.stdout);
  const againTable = parseDarwinProcessTable(again.stdout);
  const excluded = new Set([tracker.selfPid, first.pid, withEnv.pid, again.pid]);
  const marker = `${SHARD_OWNER_ENV}=${tracker.owner}`;

  const live = [...envTable.values()].filter((p) => p.pid > 1 && !excluded.has(p.pid) && !p.state.startsWith("Z"));
  const sameUid = live.filter((p) => p.uid === tracker.euid);
  const owned = new Map(); // pid -> how
  const pending = new Map(); // owned only by an immature identity
  const changedUid = [];
  for (const p of live) {
    const known = tracker.identities.get(p.pid);
    const sameProcess = known && known.startSec === p.startSec;
    if (p.uid !== tracker.euid) {
      if (sameProcess) changedUid.push(p);
      continue;
    }
    const env = darwinEnvironmentWords(argsTable.get(p.pid), p, againTable.get(p.pid));
    if (env?.includes(marker)) owned.set(p.pid, "token");
    else if (sameProcess && darwinMature(tracker, known)) owned.set(p.pid, "identity");
    else if (sameProcess) pending.set(p.pid, p);
  }
  for (const p of owned.keys()) pending.delete(p);

  // Lineage and group membership, to a fixpoint.
  const groups = new Set(tracker.groups);
  let grew = true;
  while (grew) {
    grew = false;
    const byPid = (pid) => owned.has(pid);
    for (const pid of owned.keys()) {
      const p = envTable.get(pid);
      if (p.pgid === p.pid) groups.add(p.pid);
    }
    const witnessed = new Set();
    for (const pid of owned.keys()) {
      const g = envTable.get(pid).pgid;
      if (groups.has(g)) witnessed.add(g);
    }
    for (const p of sameUid) {
      if (owned.has(p.pid)) continue;
      if (byPid(p.ppid)) owned.set(p.pid, "descendant");
      else if (witnessed.has(p.pgid)) owned.set(p.pid, "group");
      else continue;
      pending.delete(p.pid);
      grew = true;
    }
  }

  // Fresh proofs refresh the identity; an identity seen with another start
  // time belonged to a process that is gone.
  for (const [pid, known] of tracker.identities) {
    const p = envTable.get(pid);
    if (!p || p.state.startsWith("Z") || p.startSec !== known.startSec) tracker.identities.delete(pid);
  }
  for (const pid of owned.keys()) {
    const p = envTable.get(pid);
    tracker.identities.set(pid, { pid, startSec: p.startSec, observedAt: wall });
  }
  for (const g of groups) tracker.groups.add(g);

  const result = [];
  for (const [pid, via] of owned) {
    const p = envTable.get(pid);
    const mature = darwinMature(tracker, tracker.identities.get(pid));
    result.push({ pid, ppid: p.ppid, uid: p.uid, pgid: p.pgid, state: p.state, startSec: p.startSec, startTime: p.startTime, via, verified: true, mature });
  }
  const unverified = (p, why) => ({ pid: p.pid, ppid: p.ppid, uid: p.uid, pgid: p.pgid, state: p.state, startSec: p.startSec, startTime: p.startTime, via: why, verified: false, mature: false });
  for (const p of pending.values()) result.push(unverified(p, "immature-identity"));
  for (const p of changedUid) result.push(unverified(p, "changed-uid"));
  const doubtful = new Set([...pending.keys(), ...changedUid.map((p) => p.pid)]);
  for (const p of sameUid) {
    if (!owned.has(p.pid) && !doubtful.has(p.pid) && tracker.groups.has(p.pgid)) {
      result.push(unverified(p, "unwitnessed-group"));
      doubtful.add(p.pid);
    }
  }
  // Same-uid children of a process that cannot be proven are not proven
  // either, but they are not ruled out: they keep cleanup from succeeding.
  let more = true;
  while (more) {
    more = false;
    for (const p of sameUid) {
      if (owned.has(p.pid) || doubtful.has(p.pid) || !doubtful.has(p.ppid)) continue;
      result.push(unverified(p, "unverified-descendant"));
      doubtful.add(p.pid);
      more = true;
    }
  }
  return result.sort((a, b) => a.pid - b.pid);
}

export function findOwnedDarwinProcesses(owner, { euid = process.geteuid(), selfPid = process.pid, runPs = runDarwinPs, tracker } = {}) {
  return scanDarwinOwnership(tracker ?? createDarwinOwnershipTracker(owner, { euid, selfPid }), { runPs });
}

// Re-reads one PID right before it is signalled. Only a process that still
// has the tracked, mature identity, this uid and the same group qualifies.
export function revalidateDarwinProcess(tracker, seen, { runPs = runDarwinPs } = {}) {
  const known = tracker.identities.get(seen.pid);
  if (!known || known.startSec !== seen.startSec || !darwinMature(tracker, known)) return null;
  darwinCheckClock(tracker, tracker.wall(), tracker.mono());
  const now = parseDarwinProcessTable(runPs(darwinPsPidArgs(seen.pid)).stdout, { allowEmpty: true }).get(seen.pid);
  if (!now || now.state.startsWith("Z")) return null;
  if (now.startSec !== known.startSec || now.uid !== tracker.euid || now.pgid !== seen.pgid) return null;
  return now;
}

// Signals the verified, mature processes of the latest scan. Group leaders
// go first and take their group; a member of a group signalled in this
// round is not signalled again, because its PID may already be recycled.
export function signalOwnedDarwinProcesses(processes, signal, { tracker, kill = process.kill.bind(process), runPs = runDarwinPs } = {}) {
  if (!tracker) throw new Error("darwin signalling needs an ownership tracker");
  const targets = processes
    .filter((p) => p.verified && p.mature)
    .sort((a, b) => Number(b.pgid === b.pid) - Number(a.pgid === a.pid) || a.pid - b.pid);
  const signalledGroups = new Set();
  const signalled = [];
  for (const seen of targets) {
    if (signalledGroups.has(seen.pgid)) continue;
    const now = revalidateDarwinProcess(tracker, seen, { runPs });
    if (!now) continue;
    const group = now.pgid === now.pid;
    try {
      kill(group ? -now.pid : now.pid, signal);
      signalled.push({ pid: now.pid, group, signal });
      if (group) signalledGroups.add(now.pid);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  return signalled;
}

// Picks how ownership is proven on this host. Readable procfs wins; macOS
// uses the ps snapshots; anything else (including Linux with /proc missing
// or unreadable) has no verified source, and cleanup fails closed.
export function ownershipSource({ procRoot = "/proc", platform = process.platform } = {}) {
  if (procfsAvailable(procRoot)) return "procfs";
  if (platform === "darwin") return "darwin-ps";
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ends the transient server a shard started, and only that server.
 *
 * Returns { ok, reason, signalled, survivors, foreignListener, verification }.
 * `ok: false` means cleanup could not be established; the caller fails closed.
 */
export async function cleanupShardServer({
  owner,
  port,
  stateFile,
  host = SHARD_SERVER_HOST,
  selfExitMs = 10_000,
  termMs = 5_000,
  killMs = 5_000,
  pollMs = 100,
  procRoot = "/proc",
  euid = process.geteuid(),
  kill = process.kill.bind(process),
  probe = isPortListening,
  readDirectory = readdirSync,
  platform = process.platform,
  runPs = runDarwinPs,
  clock,
} = {}) {
  if (!isShardOwnerToken(owner)) throw new Error("invalid shard owner token");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid shard port");
  const source = ownershipSource({ procRoot, platform });
  const result = { ok: false, reason: null, signalled: [], survivors: [], foreignListener: false, verification: source ?? "port-only" };

  if (!source) {
    // Without /proc, ownership cannot be proven, so nothing is signalled. The
    // launcher's watchdog may stop the listener, but a free port cannot prove
    // that every owned process exited. Cleanup must still fail closed.
    result.verification = "port-only";
    const deadline = Date.now() + selfExitMs;
    while (await probe(host, port)) {
      if (Date.now() >= deadline) {
        result.reason = "process ownership cannot be verified and the shard port is still held";
        return result;
      }
      await sleep(pollMs);
    }
    result.reason = "process ownership cannot be verified without readable procfs or a supported process table";
    return result;
  }

  // The process-table scan is the authority: every process of the shard's
  // tree inherits the owner token. On macOS the tracker also remembers every
  // identity it proved, so an orphan that lost its ancestry stays owned. The
  // state file is only cleaned up at the end.
  const tracker = source === "darwin-ps" ? createDarwinOwnershipTracker(owner, { euid, clock }) : null;
  const scan = source === "procfs"
    ? () => findOwnedProcesses(owner, { procRoot, euid, readDirectory })
    : () => scanDarwinOwnership(tracker, { runPs });

  const waitGone = async (ms) => {
    const deadline = Date.now() + ms;
    let left = scan();
    while (left.length && Date.now() < deadline) {
      await sleep(pollMs);
      left = scan();
    }
    return left;
  };

  const signalOwned = async (processes, signal) => {
    if (source === "procfs") {
      result.signalled.push(...signalOwnedProcesses(processes, signal, { owner, procRoot, euid, kill }));
      return;
    }
    // A process younger than the start-time resolution cannot be told from a
    // recycled PID yet. Wait for it to mature (bounded), then signal from a
    // fresh scan; each PID is re-read again right before its own signal.
    let current = processes;
    const deadline = Date.now() + 3 * (1000 + DARWIN_CLOCK_MARGIN_MS);
    while (current.some((p) => p.verified && !p.mature) && Date.now() < deadline) {
      await sleep(Math.max(pollMs, 50));
      current = scan();
    }
    result.signalled.push(...signalOwnedDarwinProcesses(current, signal, { tracker, kill, runPs }));
  };

  let remaining;
  try {
    // The launcher watches its runner and normally stops on its own.
    remaining = await waitGone(selfExitMs);
    if (remaining.length) {
      await signalOwned(remaining, "SIGTERM");
      remaining = await waitGone(termMs);
    }
    if (remaining.length) {
      await signalOwned(remaining, "SIGKILL");
      remaining = await waitGone(killMs);
    }
  } catch (error) {
    result.reason = `shard server signal failed: ${error.code || error.message}`;
    try { result.survivors = scan().map((p) => p.pid); }
    catch { /* Enumeration failure leaves survivors unknown and ok false. */ }
    return result;
  }
  if (remaining.length) {
    result.survivors = remaining.map((p) => p.pid);
    const unverified = remaining.filter((p) => p.verified === false).map((p) => p.pid);
    result.reason = `owned shard server processes survived cleanup: ${result.survivors.join(", ")}`;
    if (unverified.length) result.reason += ` (not signalled, ownership not verifiable: ${unverified.join(", ")})`;
    return result;
  }

  // Nothing this shard owns is alive. A listener that still answers belongs
  // to someone else; report it, never signal it.
  result.foreignListener = await probe(host, port);
  const { state } = readShardServerState(stateFile, { owner, port, euid });
  if (state) rmSync(stateFile, { force: true });
  result.ok = true;
  return result;
}
