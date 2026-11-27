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
//     owner token in its environment, and an unchanged kernel start time,
//     re-read right before the signal. Only Linux /proc offers that proof.
//     macOS has no /proc and `ps` cannot separate the environment from the
//     arguments, so on macOS nothing is signalled at all; cleanup only
//     observes, conservatively (see "macOS: observe, never signal" below).
//     A PID that was reused by another program fails the token and
//     start-time checks. A listener without the token is never touched,
//     even when it holds the shard's port.
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

// macOS: observe, never signal
//
// macOS has no /proc and no stock tool that prints a process environment on
// its own. `/bin/ps -E` appends the environment to the arguments with plain
// spaces, so its output cannot prove that `WEBSITE_TRANSIENT_OWNER=<token>`
// is an environment variable rather than an argument or part of another
// variable's value. Comparing snapshots with and without `-E` does not fix
// that: a process can change its arguments between reads. `ps` start times
// also have only one-second resolution. Ownership read from `ps` is
// therefore never used to authorize a signal: on macOS this guard signals
// nothing.
//
// It still checks cleanup, conservatively. The launcher's own watchdog
// stops the server when its runner is gone, and cleanup waits for that.
// Every scan reads one `ps -axww -E` snapshot (`TZ=UTC0`, `LC_ALL=C`,
// minimal PATH, no shard token, 10-second timeout). A process "may be
// owned" when any of these holds:
//
//   * its line (arguments or environment) contains the exact
//     `WEBSITE_TRANSIENT_OWNER=<token>` word;
//   * it is a child of a process that may be owned;
//   * it shares a process group with one, or sits in a group that one led
//     at an earlier scan;
//   * it is a process (PID plus start time) that may have been owned at an
//     earlier scan. Identities are kept for the whole cleanup, so an orphan
//     that lost its parent, title or group is still counted.
//
// Over-counting only makes cleanup fail. Cleanup succeeds only when a scan
// finds no such process and the shard port is free. A `ps` failure, timeout,
// empty table, duplicate PID or unparseable line fails the scan.
//
// Limits: a process whose environment macOS hides (Apple platform binaries
// such as /bin/sh) and that never showed the token, never descended from or
// shared a group with a process that did, and was never seen at an earlier
// scan, is invisible. The shard's server tree is Node processes, whose
// environment is visible to the same uid.
export const DARWIN_PS = "/bin/ps";
export const DARWIN_PS_ARGS = ["-axww", "-E", "-o", "pid=,ppid=,uid=,pgid=,stat=,lstart=,command="];
export const DARWIN_PS_ENV = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC0" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DARWIN_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}) ([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})(?:\s+(.*))?$/;

export function runDarwinPs({ spawn = spawnSync, timeoutMs = 10_000 } = {}) {
  const result = spawn(DARWIN_PS, DARWIN_PS_ARGS, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    // No token, fixed locale and UTC start times, nothing inherited.
    env: { ...DARWIN_PS_ENV },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`cannot enumerate owned processes: ps ${result.error.code || result.error.message}`);
  if (result.signal) throw new Error(`cannot enumerate owned processes: ps terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`cannot enumerate owned processes: ps exited with status ${result.status}`);
  return { stdout: String(result.stdout ?? ""), pid: result.pid };
}

function darwinStartSeconds(month, day, hh, mm, ss, year) {
  const m = MONTHS.indexOf(month);
  const [y, d, h, mi, se] = [year, day, hh, mm, ss].map(Number);
  if (m < 0 || h > 23 || mi > 59 || se > 59) return NaN;
  const ms = Date.UTC(y, m, d, h, mi, se);
  const check = new Date(ms);
  // Every field must survive the round trip: no rolled-over day or time.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m || check.getUTCDate() !== d
    || check.getUTCHours() !== h || check.getUTCMinutes() !== mi || check.getUTCSeconds() !== se) return NaN;
  return ms / 1000;
}

// Parses one snapshot into a Map keyed by PID.
export function parseDarwinProcessTable(stdout) {
  const lines = String(stdout).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.every((line) => line.trim() === "")) {
    throw new Error("cannot enumerate owned processes: ps returned an empty process table");
  }
  const table = new Map();
  for (const line of lines) {
    const match = DARWIN_LINE_RE.exec(line);
    if (!match) throw new Error(`cannot enumerate owned processes: unparseable ps line: ${line.slice(0, 120)}`);
    const [, pid, ppid, uid, pgid, state, , month, day, hh, mm, ss, year, command = ""] = match;
    const startSec = darwinStartSeconds(month, day, hh, mm, ss, year);
    if (!Number.isFinite(startSec)) throw new Error(`cannot enumerate owned processes: unparseable ps start time: ${line.slice(0, 120)}`);
    const row = { pid: Number(pid), ppid: Number(ppid), uid: Number(uid), pgid: Number(pgid), state, startSec, command };
    if (table.has(row.pid)) throw new Error(`cannot enumerate owned processes: ps listed PID ${row.pid} twice`);
    table.set(row.pid, row);
  }
  return table;
}

export function createDarwinTracker(owner, { selfPid = process.pid } = {}) {
  if (!isShardOwnerToken(owner)) throw new Error("invalid shard owner token");
  // identities: pid -> startSec; groups: PGIDs led by a process that may be owned.
  return { owner, selfPid, identities: new Map(), groups: new Set() };
}

// One scan. Returns every live process that may belong to this shard, sorted
// by PID, and remembers them in the tracker. Never used to signal.
export function scanDarwinProcesses(tracker, { runPs = runDarwinPs } = {}) {
  const snapshot = runPs();
  const table = parseDarwinProcessTable(snapshot.stdout);
  const marker = `${SHARD_OWNER_ENV}=${tracker.owner}`;
  const excluded = new Set([tracker.selfPid, snapshot.pid]);
  const live = [...table.values()].filter((p) => p.pid > 1 && !excluded.has(p.pid) && !p.state.startsWith("Z"));

  const found = new Map();
  for (const p of live) {
    if (p.command.split(" ").includes(marker)) found.set(p.pid, "token-text");
    else if (tracker.identities.get(p.pid) === p.startSec) found.set(p.pid, "seen-before");
  }
  let grew = true;
  while (grew) {
    grew = false;
    const groups = new Set(tracker.groups);
    for (const pid of found.keys()) {
      const p = table.get(pid);
      groups.add(p.pgid);
      if (p.pgid === p.pid) tracker.groups.add(p.pid);
    }
    for (const p of live) {
      if (found.has(p.pid)) continue;
      if (found.has(p.ppid)) found.set(p.pid, "descendant");
      else if (groups.has(p.pgid)) found.set(p.pid, "group");
      else continue;
      grew = true;
    }
  }

  for (const [pid, startSec] of tracker.identities) {
    const p = table.get(pid);
    if (!p || p.state.startsWith("Z") || p.startSec !== startSec) tracker.identities.delete(pid);
  }
  for (const pid of found.keys()) tracker.identities.set(pid, table.get(pid).startSec);
  return [...found].map(([pid, via]) => {
    const { ppid, uid, pgid, state, startSec } = table.get(pid);
    return { pid, ppid, uid, pgid, state, startSec, via };
  }).sort((a, b) => a.pid - b.pid);
}

export function findOwnedDarwinProcesses(owner, { selfPid = process.pid, runPs = runDarwinPs } = {}) {
  return scanDarwinProcesses(createDarwinTracker(owner, { selfPid }), { runPs });
}

// Picks how ownership is proven on this host. Readable procfs wins; macOS
// observes `ps` snapshots without signalling; anything else (including Linux with /proc missing
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

  if (source === "darwin-ps") {
    // macOS: nothing is signalled (see "macOS: observe, never signal"). The
    // launcher's watchdog stops the tree; cleanup succeeds only once a scan
    // finds nothing that may belong to this shard and the port is free.
    const tracker = createDarwinTracker(owner);
    const deadline = Date.now() + selfExitMs + termMs + killMs;
    let left;
    let held;
    try {
      for (;;) {
        left = scanDarwinProcesses(tracker, { runPs });
        held = await probe(host, port);
        if ((!left.length && !held) || Date.now() >= deadline) break;
        await sleep(pollMs);
      }
    } catch (error) {
      result.reason = `shard server cleanup could not be verified: ${error.code || error.message}`;
      return result;
    }
    if (left.length) {
      result.survivors = left.map((p) => p.pid);
      result.reason = `shard server processes may still be running (macOS cleanup never signals; ownership from ps is not proof): ${result.survivors.join(", ")}`;
      return result;
    }
    if (held) {
      // Without proof of who holds it, a held port is not reported as foreign.
      result.reason = "the shard port is still held and its owner cannot be verified on macOS";
      return result;
    }
    const { state } = readShardServerState(stateFile, { owner, port, euid });
    if (state) rmSync(stateFile, { force: true });
    result.ok = true;
    return result;
  }

  // The /proc scan is the authority: every process of the shard's tree
  // inherits the owner token. The state file is only cleaned up at the end.
  const scan = () => findOwnedProcesses(owner, { procRoot, euid, readDirectory });

  const waitGone = async (ms) => {
    const deadline = Date.now() + ms;
    let left = scan();
    while (left.length && Date.now() < deadline) {
      await sleep(pollMs);
      left = scan();
    }
    return left;
  };

  const signalOwned = (processes, signal) => {
    result.signalled.push(...signalOwnedProcesses(processes, signal, { owner, procRoot, euid, kill }));
  };

  let remaining;
  try {
    // The launcher watches its runner and normally stops on its own.
    remaining = await waitGone(selfExitMs);
    if (remaining.length) {
      signalOwned(remaining, "SIGTERM");
      remaining = await waitGone(termMs);
    }
    if (remaining.length) {
      signalOwned(remaining, "SIGKILL");
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
    result.reason = `owned shard server processes survived cleanup: ${result.survivors.join(", ")}`;
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
