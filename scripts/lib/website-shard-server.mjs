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
//   * Ownership. A process is signalled only when /proc proves it belongs to
//     this shard: every uid equal to this runner's euid, the shard's owner
//     token in its environment (never its argv), and an unchanged kernel
//     start time between the scan and the signal. Signals go to single
//     verified PIDs, never to a process group. A PID that was reused by
//     another program fails the token and start-time checks. A listener that
//     cannot be attributed is never touched, even when it holds the port.
//   * Fail closed. Every PID is classified as exited, foreign, owned or
//     uncertain (see classifyProcess). Cleanup succeeds only when no owned
//     and no uncertain process remains, the port is free, and a final scan
//     after the port check still finds nothing. An owned process that
//     survives SIGTERM and SIGKILL, a refused signal, a live process whose
//     ownership cannot be read, an unattributed listener, or a failed scan
//     makes cleanup report failure; local-ci then stops the remaining shards
//     instead of starting the next one beside a leftover.
//
// Scope: Linux procfs with the default `hidepid=0` mount. Under `hidepid=1`
// other users' status files are unreadable, so their processes count as
// uncertain and cleanup fails closed. macOS has no /proc and always fails
// closed (internal/docs/local-ci.md, macos-browser-shard-cleanup.md).
//
// The guard touches only the processes it proves it owns. It writes no unit,
// schedule or machine setting.

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

// Resolves false only when the connection is refused, which is the one answer
// that shows nothing listens. A timeout or any other error cannot show the
// port is free, so it counts as held.
export function isPortListening(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(error?.code !== "ECONNREFUSED"));
  });
}

// ENOENT/ESRCH on a /proc/<pid> file means the PID is gone. Every other error
// (EACCES, EPERM, EIO, EISDIR...) says nothing about whether the process lives.
const GONE_CODES = new Set(["ENOENT", "ESRCH"]);
// Zombies and dead tasks hold no sockets and cannot be signalled into exiting.
const EXITED_STATES = new Set(["Z", "X", "x"]);
// task->flags bit for kernel threads (include/linux/sched.h).
const PF_KTHREAD = 0x00200000;

function readProcFile(readFile, file) {
  try {
    return { text: readFile(file, "utf8"), error: null };
  } catch (error) {
    return { text: null, error: error?.code || "EIO" };
  }
}

// comm may contain spaces and parentheses; fields resume after the last ')'.
function parseStat(text) {
  if (!isString(text)) return null;
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const fields = text.slice(close + 2).trim().split(" ");
  if (fields.length < 20) return null;
  const state = fields[0];
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  const session = Number(fields[3]);
  const flags = Number(fields[6]);
  const startTime = fields[19];
  if (!/^[A-Za-z]$/.test(state)) return null;
  if (!Number.isInteger(ppid) || ppid < 0 || !Number.isInteger(session) || session < 0) return null;
  if (!Number.isInteger(pgid) || pgid < 0) return null;
  if (!Number.isInteger(flags) || flags < 0) return null;
  if (!/^\d+$/.test(startTime)) return null;
  return { state, ppid, pgid, session, flags, startTime };
}

// Real, effective, saved and filesystem uid, or null when malformed.
function parseUids(text) {
  if (!isString(text)) return null;
  const line = text.split("\n").find((entry) => entry.startsWith("Uid:"));
  if (!line) return null;
  const parts = line.slice(4).trim().split(/\s+/);
  if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.map(Number);
}

function readOnce(pid, dir, readFile) {
  const gone = { kind: "gone", pid };
  const statRead = readProcFile(readFile, path.join(dir, "stat"));
  if (GONE_CODES.has(statRead.error)) return gone;
  const stat = parseStat(statRead.text);
  if (stat && EXITED_STATES.has(stat.state)) return gone;

  const statusRead = readProcFile(readFile, path.join(dir, "status"));
  if (GONE_CODES.has(statusRead.error)) return gone;
  const uids = parseUids(statusRead.text);

  const environRead = readProcFile(readFile, path.join(dir, "environ"));
  if (GONE_CODES.has(environRead.error)) return gone;

  // Re-read stat: a process that exited while we read it is gone, and a PID
  // that changed hands in between must be read again from scratch.
  const againRead = readProcFile(readFile, path.join(dir, "stat"));
  if (GONE_CODES.has(againRead.error)) return gone;
  const again = parseStat(againRead.text);
  if (again && EXITED_STATES.has(again.state)) return gone;
  if (stat && again && stat.startTime !== again.startTime) return { kind: "raced", pid };

  let dirUid = null;
  if (!uids) {
    try {
      dirUid = lstatSync(dir).uid;
    } catch (error) {
      if (GONE_CODES.has(error?.code)) return gone;
    }
  }

  return {
    kind: "read",
    pid,
    stat: stat && again ? again : null,
    statError: statRead.error || againRead.error || (stat && again ? null : "malformed"),
    uids,
    statusError: statusRead.error || (uids ? null : "malformed"),
    dirUid,
    environ: environRead.text === null ? null : environRead.text.split("\0").filter(Boolean),
    environError: environRead.error,
  };
}

/**
 * Reads what the kernel says about one PID.
 *
 * Returns one of:
 *   { kind: "gone" }      ENOENT/ESRCH, or a zombie/dead task: demonstrably exited.
 *   { kind: "excluded" }  not a PID this guard may ever consider (<= 1).
 *   { kind: "raced" }     the PID changed hands on every attempt.
 *   { kind: "read", stat, uids, dirUid, environ, ...errors }  for classifyProcess.
 * It never throws for an individual PID.
 */
export function readProcessIdentity(pid, procRoot = "/proc", { readFile = readFileSync, attempts = 3 } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return { kind: "excluded", pid };
  const dir = path.join(procRoot, String(pid));
  let read = { kind: "raced", pid };
  for (let attempt = 0; attempt < attempts && read.kind === "raced"; attempt++) {
    read = readOnce(pid, dir, readFile);
  }
  return read;
}

/**
 * Decides what one PID means for this shard.
 *
 *   gone       demonstrably exited; ignore.
 *   foreign    provably not this shard's: another uid without the token, a
 *              kernel thread, a fully readable environment without it, or an
 *              unreadable environment with proven unrelated ancestry, group
 *              and session when the shard server identity is available, and
 *              a start before the server. A descendant that called setsid
 *              and was reparented to PID 1 or a subreaper loses its ancestry,
 *              and it can move itself into another writable cgroup, so
 *              neither ancestry nor cgroup ever clears a process started at
 *              or after the server.
 *   owned      every uid is euid, the token is in the environment, and the
 *              identity is complete. Only these are ever signalled.
 *   uncertain  could be this shard's and cannot be proven either way: the
 *              token under changed credentials, or a same-uid (or unknown
 *              uid) process whose stat, status or environ is unreadable,
 *              malformed, empty, or changed while it was read. Never
 *              signalled; makes cleanup fail while it lives.
 *
 * `shard` optionally supplies the verified server identity and a PID-to-read
 * map for ancestry checks. Without it, protected environments stay uncertain.
 *
 * The token in argv (/proc/<pid>/cmdline) is never read: a process can put
 * any text there, so it is not proof of anything.
 */
export function classifyProcess(read, owner, euid, shard = null) {
  const { pid } = read;
  if (read.kind === "gone") return { verdict: "gone", pid };
  if (read.kind === "excluded") return { verdict: "foreign", pid, reason: "excluded PID" };
  if (read.kind === "raced") return { verdict: "uncertain", pid, reason: "identity changed while it was read" };

  const startTime = read.stat?.startTime ?? null;
  const token = isShardOwnerToken(owner) ? `${SHARD_OWNER_ENV}=${owner}` : null;
  const tokenSeen = Boolean(token && read.environ?.includes(token));
  const uncertain = (reason) => ({ verdict: "uncertain", pid, startTime, tokenSeen, reason });

  // Relevance: could this process run as us? Status is world-readable under
  // the default procfs mount, so another user's process is normally known to
  // be foreign without reading its (protected) environment. When status is
  // unreadable the /proc/<pid> owner is the task's euid, or root when the task
  // is not dumpable, so only a third uid proves the process foreign.
  const relevant = read.uids
    ? read.uids.includes(euid)
    : read.dirUid === null || read.dirUid === euid || read.dirUid === 0;
  if (!relevant) {
    return tokenSeen
      ? uncertain("carries this shard's token under another uid")
      : { verdict: "foreign", pid, reason: "another uid" };
  }
  if (!read.stat) return uncertain(`stat ${read.statError}`);
  if (!read.uids) return uncertain(`status ${read.statusError}`);
  if (read.stat.flags & PF_KTHREAD) return { verdict: "foreign", pid, reason: "kernel thread" };
  if (read.environ === null) {
    // Only a complete, unrelated ancestry plus a start before the server can
    // excuse a protected environment. Missing
    // shard/ancestor stat data stays fail-closed. Group or session
    // membership is evidence of possible ownership, never permission to signal.
    if (shard && !couldBelongToShard(read, shard)) {
      return { verdict: "foreign", pid, reason: "unrelated same-uid process with unreadable environ" };
    }
    return uncertain(`environ ${read.environError}`);
  }
  // A user process normally has at least one variable. Linux returns an empty
  // environ while a task tears down its memory on exit, so empty is uncertain
  // until the task is visibly gone.
  if (read.environ.length === 0) return uncertain("empty environment");
  if (!tokenSeen) return { verdict: "foreign", pid, reason: "no shard token" };
  if (!read.uids.every((uid) => uid === euid)) return uncertain("carries this shard's token with changed credentials");
  return {
    verdict: "owned",
    pid,
    identity: {
      pid,
      state: read.stat.state,
      pgid: read.stat.pgid,
      startTime: read.stat.startTime,
      uid: read.uids[0],
      uids: read.uids,
    },
  };
}

function couldBelongToShard(read, { serverIdentity, processes }) {
  if (!serverIdentity?.stat || !processes) return true;
  const { pid, stat } = serverIdentity;
  if (read.pid === pid || read.stat.pgid === stat.pgid || read.stat.session === stat.session) return true;
  const visited = new Set();
  let ancestor = read.stat.ppid;
  while (ancestor > 1) {
    if (ancestor === pid || visited.has(ancestor)) return true;
    visited.add(ancestor);
    const parent = processes.get(ancestor);
    if (!parent?.stat) return true;
    ancestor = parent.stat.ppid;
  }
  // The chain reached PID 1 without passing the server. A shard descendant
  // that called setsid and whose parent exited looks exactly like this, so
  // only a start before the server proves the process unrelated. A cgroup
  // move is not proof: a descendant can enter any writable delegated cgroup.
  if (startsBefore(read.stat.startTime, stat.startTime)) return false;
  return true;
}

function startsBefore(startTime, serverStartTime) {
  if (!/^\d+$/.test(startTime ?? "") || !/^\d+$/.test(serverStartTime ?? "")) return false;
  return BigInt(startTime) < BigInt(serverStartTime);
}

export function procfsAvailable(procRoot = "/proc") {
  try {
    return existsSync(path.join(procRoot, "self", "stat"));
  } catch {
    return false;
  }
}

const baselineKey = (pid, startTime) => `${pid}:${startTime}`;

function listPids(procRoot, readDirectory) {
  let entries;
  try {
    entries = readDirectory(procRoot);
  } catch (error) {
    throw new Error(`cannot enumerate owned processes: ${error.code || error.message}`);
  }
  return entries.filter((entry) => /^\d+$/.test(entry)).map(Number);
}

/**
 * Scans /proc once and sorts every PID by classifyProcess.
 *
 * `baseline` (from snapshotShardBaseline) lists uncertain processes that were
 * already running, with the same start time, before the shard started. A
 * process that predates the shard cannot have been given its token, so such
 * entries are dropped unless the token was actually seen.
 *
 * Returns { owned: identity[], uncertain: {pid, startTime, reason}[] }.
 * Throws when /proc cannot be enumerated.
 */
export function scanShardProcesses(owner, {
  procRoot = "/proc",
  euid = process.geteuid(),
  selfPid = process.pid,
  readDirectory = readdirSync,
  readFile = readFileSync,
  baseline = null,
  serverIdentity = null,
} = {}) {
  const owned = [];
  const uncertain = [];
  const known = baseline ? new Set(baseline) : null;
  const processes = new Map(listPids(procRoot, readDirectory).map((pid) =>
    [pid, readProcessIdentity(pid, procRoot, { readFile })]));
  for (const [pid, read] of processes) {
    if (pid === selfPid) continue;
    const result = classifyProcess(read, owner, euid, { serverIdentity, processes });
    if (result.verdict === "owned") owned.push(result.identity);
    else if (result.verdict === "uncertain") {
      const predates = known && !result.tokenSeen && result.startTime !== null && known.has(baselineKey(pid, result.startTime));
      if (!predates) uncertain.push({ pid, startTime: result.startTime ?? null, reason: result.reason });
    }
  }
  const byPid = (a, b) => a.pid - b.pid;
  return { owned: owned.sort(byPid), uncertain: uncertain.sort(byPid) };
}

export function findOwnedProcesses(owner, options = {}) {
  return scanShardProcesses(owner, options).owned;
}

/**
 * Records same-uid processes whose ownership cannot be read (for example
 * non-dumpable agents with protected environments) before a shard starts, so
 * cleanup can tell them apart from processes the shard created. Returns null
 * when procfs is unavailable or cannot be enumerated: no baseline, no
 * exclusions.
 */
export function snapshotShardBaseline({ procRoot = "/proc", ...options } = {}) {
  if (!procfsAvailable(procRoot)) return null;
  try {
    const { uncertain } = scanShardProcesses(null, { procRoot, ...options });
    return uncertain.filter((entry) => entry.startTime !== null).map((entry) => baselineKey(entry.pid, entry.startTime));
  } catch {
    return null;
  }
}

// Signals only processes whose identity is re-read immediately before the
// signal and still classifies as owned with the same kernel start time. A
// recycled PID has a different start time and no token, and a process that
// became unreadable is no longer proven, so both are skipped. ESRCH (already
// gone) is fine; any other refusal is thrown so the caller fails closed.
//
// Every signal goes to one positive PID, never to a process group. kill(-pgid)
// reaches every member of the group, and membership proves nothing: a group
// can hold an uncertain member (unreadable environ), a member that dropped
// the token, or an unrelated process that joined with setpgid. Group
// ownership cannot be established from /proc without classifying every
// member, and the member list can change between that check and the signal,
// so the guard does not claim it. Each shard process inherits the token, so
// it is found and signalled on its own; a member that cannot be proven owned
// is left alone and fails cleanup while it lives.
//
// Residual race: Linux offers no PID-reuse-safe signal from Node (no
// pidfd_send_signal). Between the re-read and kill(), the verified process can
// exit, be reaped by its parent, and the kernel can hand the PID to a new
// process. That window is a few system calls wide and needs the PID space to
// wrap in it; the guard narrows it to the re-read immediately before each
// kill() and does not claim to close it.
export function signalOwnedProcesses(processes, signal, {
  owner,
  procRoot = "/proc",
  euid = process.geteuid(),
  kill = process.kill.bind(process),
  readFile = readFileSync,
} = {}) {
  const signalled = [];
  for (const seen of processes) {
    if (!Number.isInteger(seen?.pid) || seen.pid <= 1) continue;
    const now = classifyProcess(readProcessIdentity(seen.pid, procRoot, { readFile }), owner, euid);
    if (now.verdict !== "owned" || now.identity.startTime !== seen.startTime) continue;
    try {
      kill(now.pid, signal);
      signalled.push({ pid: now.pid, signal });
    } catch (error) {
      if (error.code !== "ESRCH") throw Object.assign(new Error(`shard server signal failed: ${error.code || error.message}`), { signalFailure: true });
    }
  }
  return signalled;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const describeUncertain = (entries) => entries.map((entry) => `${entry.pid} (${entry.reason})`).join(", ");

/**
 * Ends the transient server a shard started, and only that server.
 *
 * Returns { ok, reason, signalled, survivors, uncertain, unattributedListener,
 * verification }. `ok: false` means cleanup could not be established; the
 * caller fails closed. Nothing is ever signalled on the strength of a port
 * probe, the state file, argv, or an unreadable identity.
 */
export async function cleanupShardServer({
  owner,
  port,
  stateFile,
  host = SHARD_SERVER_HOST,
  selfExitMs = 10_000,
  termMs = 5_000,
  killMs = 5_000,
  listenerGraceMs = 2_000,
  pollMs = 100,
  procRoot = "/proc",
  euid = process.geteuid(),
  selfPid = process.pid,
  kill = process.kill.bind(process),
  probe = isPortListening,
  readDirectory = readdirSync,
  readFile = readFileSync,
  baseline = null,
} = {}) {
  if (!isShardOwnerToken(owner)) throw new Error("invalid shard owner token");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid shard port");
  const result = {
    ok: false, reason: null, signalled: [], survivors: [], uncertain: [], unattributedListener: false, verification: "procfs",
  };

  // A probe that throws cannot show the port is free.
  const portHeld = async () => {
    try {
      return Boolean(await probe(host, port));
    } catch {
      return true;
    }
  };

  if (!procfsAvailable(procRoot)) {
    // Without /proc, ownership cannot be proven, so nothing is signalled. The
    // launcher's watchdog may stop the listener, but a free port cannot prove
    // that every owned process exited. Cleanup must still fail closed.
    result.verification = "port-only";
    const deadline = Date.now() + selfExitMs;
    while (await portHeld()) {
      if (Date.now() >= deadline) {
        result.unattributedListener = true;
        result.reason = "process ownership cannot be verified and the shard port is still held";
        return result;
      }
      await sleep(pollMs);
    }
    result.reason = "process ownership cannot be verified without readable procfs";
    return result;
  }

  // The /proc scan is the authority: every process of the shard's tree
  // inherits the owner token. The state file is only cleaned up at the end.
  const { state: serverState } = readShardServerState(stateFile, { owner, port, euid });
  const serverRead = serverState?.pid > 1
    ? readProcessIdentity(serverState.pid, procRoot, { readFile }) : null;
  const serverIdentity = serverRead?.stat && serverRead.stat.startTime === serverState?.serverStartTime
    ? serverRead : null;
  const scan = () => scanShardProcesses(owner, { procRoot, euid, selfPid, readDirectory, readFile, baseline, serverIdentity });
  const settled = (state) => !state.owned.length && !state.uncertain.length;

  // Waits for owned and uncertain processes alike: a process whose identity
  // is briefly unreadable while it exits must not fail cleanup.
  const waitSettled = async (ms) => {
    const deadline = Date.now() + ms;
    let state = scan();
    while (!settled(state) && Date.now() < deadline) {
      await sleep(pollMs);
      state = scan();
    }
    return state;
  };

  const signalOwned = (processes, signal) => {
    result.signalled.push(...signalOwnedProcesses(processes, signal, { owner, procRoot, euid, kill, readFile }));
  };

  let state;
  try {
    // The launcher watches its runner and normally stops on its own.
    state = await waitSettled(selfExitMs);
    if (state.owned.length) {
      signalOwned(state.owned, "SIGTERM");
      state = await waitSettled(termMs);
    }
    if (state.owned.length) {
      signalOwned(state.owned, "SIGKILL");
      state = await waitSettled(killMs);
    }
  } catch (error) {
    result.reason = error.signalFailure ? error.message : `shard server process scan failed: ${error.message}`;
    try {
      const last = scan();
      result.survivors = last.owned.map((p) => p.pid);
      result.uncertain = last.uncertain;
    } catch { /* Enumeration failure leaves survivors unknown and ok false. */ }
    return result;
  }
  if (state.owned.length) {
    result.survivors = state.owned.map((p) => p.pid);
    result.uncertain = state.uncertain;
    result.reason = `owned shard server processes survived cleanup: ${result.survivors.join(", ")}`;
    return result;
  }
  if (state.uncertain.length) {
    result.uncertain = state.uncertain;
    result.reason = `ownership of live processes cannot be established, none was signalled: ${describeUncertain(state.uncertain)}`;
    return result;
  }

  // Nothing this shard owns is visible. A listener that still answers after a
  // short grace cannot be attributed: it may be an escaped descendant that
  // dropped the token or an unrelated program. It is never signalled, and it
  // fails cleanup because the port this shard used is not demonstrably free.
  const listenerDeadline = Date.now() + listenerGraceMs;
  while (await portHeld()) {
    if (Date.now() >= listenerDeadline) {
      result.unattributedListener = true;
      result.reason = `an unattributed listener still holds shard port ${port}; it was not signalled`;
      return result;
    }
    await sleep(pollMs);
  }

  // A process may have appeared between the last scan and the port check.
  try {
    const final = scan();
    if (!settled(final)) {
      result.survivors = final.owned.map((p) => p.pid);
      result.uncertain = final.uncertain;
      const seen = [...result.survivors.map(String), describeUncertain(final.uncertain)].filter(Boolean);
      result.reason = `shard processes appeared after the port check, none was signalled: ${seen.join(", ")}`;
      return result;
    }
  } catch (error) {
    result.reason = `shard server process scan failed: ${error.message}`;
    return result;
  }

  const { state: record } = readShardServerState(stateFile, { owner, port, euid });
  if (record) rmSync(stateFile, { force: true });
  result.ok = true;
  return result;
}
