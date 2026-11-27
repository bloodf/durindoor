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
//     owner token in its environment (or, on macOS, descent from such a
//     process), and an unchanged kernel start time between the scan and the
//     signal. Linux reads /proc. macOS has no /proc, so it reads one `ps -E`
//     snapshot of the whole table (see "macOS ownership" below). A PID that was reused by another program fails the token
//     and start-time checks. A listener without the token is never touched,
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

// macOS ownership
//
// macOS has no /proc. The whole process table is read in one snapshot with
// `/bin/ps -axww -E`, which appends each process's environment to its
// arguments. The kernel serves another process's environment only to the
// same uid, which is the only uid this guard ever signals. Fields per line:
// pid, ppid, uid (effective), pgid, state, lstart (C locale, one-second
// resolution) and the argument+environment words.
//
// A process is owned when it runs as this uid and either carries the exact
// word `WEBSITE_TRANSIENT_OWNER=<token>` or descends (by ppid) from a process
// that does. The token is 32 random hex characters generated per shard, so
// no unrelated process carries it. PID + lstart names one process; a recycled
// PID inside the same second would also need the token or owned ancestry.
//
// Fail closed: a missing or failing `ps`, a timeout, empty output, or any
// line that does not parse makes enumeration throw, and cleanup reports
// failure instead of treating an unreadable table as "nothing left".
export const DARWIN_PS = "/bin/ps";
export const DARWIN_PS_ARGS = ["-axww", "-E", "-o", "pid=,ppid=,uid=,pgid=,stat=,lstart=,command="];
const DARWIN_LINE_RE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})(?:\s+(.*))?$/;

export function runDarwinPs({ spawn = spawnSync, timeoutMs = 10_000 } = {}) {
  const result = spawn(DARWIN_PS, DARWIN_PS_ARGS, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    // No token, fixed locale for lstart, nothing inherited from the shard.
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`cannot enumerate owned processes: ps ${result.error.code || result.error.message}`);
  if (result.signal) throw new Error(`cannot enumerate owned processes: ps terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`cannot enumerate owned processes: ps exited with status ${result.status}`);
  return { stdout: String(result.stdout ?? ""), pid: result.pid };
}

export function parseDarwinProcessTable(stdout) {
  const lines = String(stdout).split("\n").filter((line) => line.trim() !== "");
  if (!lines.length) throw new Error("cannot enumerate owned processes: ps returned an empty process table");
  return lines.map((line) => {
    const match = DARWIN_LINE_RE.exec(line);
    if (!match) throw new Error(`cannot enumerate owned processes: unparseable ps line: ${line.slice(0, 120)}`);
    const [, pid, ppid, uid, pgid, state, lstart, rest = ""] = match;
    return {
      pid: Number(pid),
      ppid: Number(ppid),
      uid: Number(uid),
      pgid: Number(pgid),
      state,
      startTime: lstart.replace(/\s+/g, " "),
      words: rest.split(/\s+/).filter(Boolean),
    };
  });
}

// Owned processes in one parsed table: token carriers plus their same-uid
// descendants. Zombies are already terminated and cannot hold a socket.
export function ownedDarwinProcesses(table, owner, { euid = process.geteuid(), excludePids = [] } = {}) {
  if (!isShardOwnerToken(owner)) throw new Error("invalid shard owner token");
  const marker = `${SHARD_OWNER_ENV}=${owner}`;
  const excluded = new Set(excludePids);
  const live = table.filter((p) => p.pid > 1 && !excluded.has(p.pid) && !p.state.startsWith("Z") && p.uid === euid);
  const owned = new Map();
  for (const p of live) if (p.words.includes(marker)) owned.set(p.pid, { ...p, via: "token" });
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of live) {
      if (!owned.has(p.pid) && owned.has(p.ppid)) {
        owned.set(p.pid, { ...p, via: "descendant" });
        grew = true;
      }
    }
  }
  return [...owned.values()]
    .map(({ words, ...identity }) => identity)
    .sort((a, b) => a.pid - b.pid);
}

export function findOwnedDarwinProcesses(owner, { euid = process.geteuid(), selfPid = process.pid, runPs = runDarwinPs } = {}) {
  const { stdout, pid: psPid } = runPs();
  return ownedDarwinProcesses(parseDarwinProcessTable(stdout), owner, { euid, excludePids: [selfPid, psPid] });
}

// Same contract as signalOwnedProcesses: one fresh snapshot right before the
// signals; only a PID still owned with the same lstart is signalled.
export function signalOwnedDarwinProcesses(processes, signal, { owner, euid = process.geteuid(), selfPid = process.pid, kill = process.kill.bind(process), runPs = runDarwinPs } = {}) {
  const current = new Map(findOwnedDarwinProcesses(owner, { euid, selfPid, runPs }).map((p) => [p.pid, p]));
  const signalled = [];
  for (const seen of processes) {
    const now = current.get(seen.pid);
    if (!now || now.startTime !== seen.startTime) continue;
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

// Picks how ownership is proven on this host. Readable procfs wins; macOS
// uses the ps snapshot; anything else (including Linux with /proc missing or
// unreadable) has no verified source, and cleanup fails closed.
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

  // The process-table scan is the authority: every process of the shard's
  // tree inherits the owner token. The state file is only cleaned up at the end.
  const scan = source === "procfs"
    ? () => findOwnedProcesses(owner, { procRoot, euid, readDirectory })
    : () => findOwnedDarwinProcesses(owner, { euid, runPs });

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
    result.signalled.push(...(source === "procfs"
      ? signalOwnedProcesses(processes, signal, { owner, procRoot, euid, kill })
      : signalOwnedDarwinProcesses(processes, signal, { owner, euid, kill, runPs })));
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
