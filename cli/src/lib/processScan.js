"use strict";

/**
 * Locating DurinDoor's (and legacy 9router's) own leftover processes — safely.
 *
 * Three rules the previous implementations broke:
 *
 * 1. A pid must come from the pid *column*. We used to scan `ps aux` line by line
 *    and take the second whitespace-separated token as the pid. `ps` wraps long
 *    command lines, and a wrapped continuation line still contains the strings we
 *    match on ("durindoor", "9router", "next-server", …), so the "pid" could be
 *    any number in the command text and `kill -9` then hit an unrelated process.
 *    That is how a supervisor which had merely started the CLI got killed.
 * 2. Never kill a process we descend from. The parent of a launcher process is
 *    whoever launched it — a supervisor, a shell, a service manager — never a
 *    stale copy of us. Killing it takes down the thing keeping us running.
 * 3. Shared/generic binaries (`next-server`, `cloudflared`, `tray_*`) must be
 *    verified to belong to this installation before killing (fail closed):
 *    - `next-server`: cwd (or Windows command line) inside `appDir`
 *    - `cloudflared`: PID recorded in `cloudflared.pid` or `--url` targeting `appPort`
 *    - `tray_*`: binary path inside this installation's directory (`installDir`/`dataDir`/`appDir`)
 *
 * Every candidate is re-checked (alive, and still matching) right before the
 * kill, so a recycled pid cannot be hit either.
 */

const { execSync, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PS_TIMEOUT_MS = 5000;
const MAX_ANCESTORS = 32;
/** Package names recognized for DurinDoor and legacy 9router launcher processes. */
const APP_PROCESS_IDENTIFIERS = Object.freeze(["durindoor", "9router"]);
const TRAY_BIN_NAME_RE = /^tray_(?:darwin|linux|windows)[^\s"']*$/i;

/** Extract the executable token from a command line, preserving quoted paths. */
function extractExecutable(command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

/** True when the executable is a node binary (so a shell that merely mentions node is not one). */
function looksLikeNode(executable) {
  const exe = String(executable || "").replace(/^["']|["']$/g, "").toLowerCase();
  return exe === "node" || exe === "node.exe" || /[\\/]node(\.exe)?$/.test(exe);
}

/** True when a command line represents a Next.js worker process. */
function isNextServerProcess(command) {
  return String(command || "").toLowerCase().includes("next-server");
}

/** True when the executable is a cloudflared binary. */
function isCloudflaredProcess(command) {
  const exe = extractExecutable(command).toLowerCase();
  if (exe === "cloudflared" || exe === "cloudflared.exe" || /[\\/]cloudflared(\.exe)?$/.test(exe)) {
    return true;
  }
  const trimmed = String(command || "").trim();
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) {
    return /^(?:[a-z]:[\\/]|[\\/])(?:[^"'\s]|\s+(?![\\/\-]))*?[\\/]cloudflared(?:\.exe)?(?=\s|$)/i.test(trimmed);
  }
  return false;
}

/** Extract the tray binary path when the executable is a systray helper binary. */
function extractTrayBinaryPath(command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) return null;
  const exe = extractExecutable(trimmed);
  const exeBase = exe.split(/[\\/]/).pop() || "";
  if (TRAY_BIN_NAME_RE.test(exeBase)) return exe;
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) {
    const match = trimmed.match(
      /^((?:[a-z]:[\\/]|[\\/])(?:[^"'\s]|\s+(?![\\/\-]))*?[\\/]tray_(?:darwin|linux|windows)[^\s"']*)(?=\s|$)/i,
    );
    if (match) return match[1];
  }
  return null;
}

/** True when the executable is a systray helper binary (`tray_darwin*`, `tray_linux*`, `tray_windows*`). */
function isTrayProcess(command) {
  return extractTrayBinaryPath(command) !== null;
}

/** True when a node process is running the DurinDoor or legacy 9router CLI/app. */
function isLauncherProcess(command) {
  const cmd = String(command || "");
  if (!cmd.trim()) return false;
  if (!looksLikeNode(extractExecutable(cmd))) return false;
  const lower = cmd.toLowerCase();
  const hasCliEntry = /(?:^|[\\/])cli\.js(?=$|[\s"'])/.test(lower);
  return APP_PROCESS_IDENTIFIERS.some((id) => {
    if (!lower.includes(id)) return false;
    if (hasCliEntry) return true;
    return new RegExp(`[\\\\/]${id}(?:[\\\\/\\s"']|$)`).test(lower);
  });
}

function launcherOwnedByInstall(command, options = {}) {
  const tokens = String(command || "").match(/"[^\"]*"|'[^']*'|\S+/g) || [];
  const cliIndex = tokens.findIndex((token) => /(?:^|[\\/])cli\.js$/i.test(token.replace(/^['"]|['"]$/g, "")));
  if (cliIndex < 1 || options.appPort == null) return false;
  const installCli = options.cliPath || (options.installDir && path.join(options.installDir, "cli.js"));
  if (!installCli) return false;
  let actualCli;
  let expectedCli;
  try {
    actualCli = fs.realpathSync(tokens[cliIndex].replace(/^['"]|['"]$/g, ""));
    expectedCli = fs.realpathSync(installCli);
  } catch {
    return false;
  }
  if (actualCli !== expectedCli) return false;
  let port = null;
  for (let i = cliIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i].replace(/^['"]|['"]$/g, "");
    if (token === "--port" || token === "-p") {
      const value = tokens[i + 1] && tokens[i + 1].replace(/^['"]|['"]$/g, "");
      if (!value || !/^\d+$/.test(value)) return false;
      port = Number(value);
      break;
    }
    const inline = token.match(/^--port=(\d+)$/);
    if (inline) { port = Number(inline[1]); break; }
  }
  return port !== null && port === Number(options.appPort);
}

/** Command lines that mean "a candidate process of ours". Ownership is enforced by `collectAppPids`. */
function isAppProcess(command) {
  const cmd = String(command || "");
  if (!cmd.trim()) return false;
  if (isNextServerProcess(cmd)) return true;
  if (isCloudflaredProcess(cmd)) return true;
  if (isTrayProcess(cmd)) return true;
  // A node process running the CLI or started from the package directory. The
  // executable itself has to be node: a shell or editor that merely mentions
  // these strings in its command line is not one of our processes.
  return isLauncherProcess(cmd);
}

/**
 * `ps -eo pid=,command=` output → `[{ pid, command }]`.
 *
 * Only a line whose first field is a pid is a process. `ps` is asked for unlimited
 * width (`-ww`, wide COLUMNS) precisely so it cannot wrap and slip a continuation
 * line — which may well start with a number — into this table. `collectAppPids`
 * re-reads each candidate anyway, so a stray number can never become a kill.
 */
function parseProcessTable(stdout) {
  const rows = [];
  for (const line of String(stdout || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    rows.push({ pid, command: match[2] });
  }
  return rows;
}

/** PowerShell's Win32_Process table → `[{ pid, command }]`. */
function parseWindowsProcessTable(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries
    .map(entry => ({ pid: Number(entry && entry.ProcessId), command: String((entry && entry.CommandLine) || "") }))
    .filter(entry => Number.isInteger(entry.pid) && entry.pid > 1 && entry.command.length > 0);
}

function readProcessTable() {
  if (process.platform === "win32") {
    const cmd = 'powershell -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"';
    return parseWindowsProcessTable(execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: PS_TIMEOUT_MS }));
  }
  const output = execSync("ps -ww -eo pid=,command= 2>/dev/null", {
    encoding: "utf8",
    timeout: PS_TIMEOUT_MS,
    env: { ...process.env, COLUMNS: "10000" },
  });
  return parseProcessTable(output);
}

/** The command line a pid is running right now, or null when it is gone. */
function readCommand(pid) {
  if (process.platform === "linux") {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return raw.replace(/\0/g, " ").trim() || null;
    } catch {
      return null;
    }
  }
  try {
    if (process.platform === "win32") {
      const cmd = `powershell -NonInteractive -WindowStyle Hidden -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`;
      const out = execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: PS_TIMEOUT_MS }).trim();
      return out.length > 0 ? out : null;
    }
    const out = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: "utf8", timeout: PS_TIMEOUT_MS }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function parentOf(pid) {
  try {
    if (process.platform === "linux") {
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const match = status.match(/^PPid:\s+(\d+)/m);
      return match ? Number(match[1]) : null;
    }
    if (process.platform === "win32") {
      const cmd = `powershell -NonInteractive -WindowStyle Hidden -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId"`;
      const out = execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: PS_TIMEOUT_MS }).trim();
      const parent = Number(out);
      return Number.isInteger(parent) && parent > 0 ? parent : null;
    }
    const out = execSync(`ps -o ppid= -p ${pid} 2>/dev/null`, { encoding: "utf8", timeout: PS_TIMEOUT_MS }).trim();
    const parent = Number(out);
    return Number.isInteger(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}

/**
 * Our own pid plus every ancestor: the process that started us is not a stale
 * copy of us and must never be a kill target.
 */
function ownProcessChain(startPid = process.pid, parentLookup = parentOf) {
  const chain = new Set();
  let pid = Number(startPid);
  for (let hops = 0; hops < MAX_ANCESTORS; hops += 1) {
    if (!Number.isInteger(pid) || pid <= 1 || chain.has(pid)) break;
    chain.add(pid);
    const parent = parentLookup(pid);
    if (parent === null) break;
    pid = parent;
  }
  return chain;
}

/** Fail closed when a Next worker cannot be tied to this installation. */
function ownsNextServer(pid, appDir, command, platform = process.platform) {
  if (!appDir) return false;
  if (platform === "win32") {
    const normalize = value => String(value).replace(/\//g, "\\").toLowerCase();
    const target = normalize(appDir).replace(/\\+$/, "");
    // Require a path boundary, not a similarly prefixed installation.
    return normalize(command).includes(target + "\\");
  }
  try {
    const cwd = platform === "linux"
      ? fs.readlinkSync(`/proc/${pid}/cwd`)
      : execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        { encoding: "utf8", timeout: 3000 }).split("\n").find(line => line.startsWith("n"))?.slice(1);
    if (!cwd) return false;
    const relative = path.relative(fs.realpathSync(appDir), fs.realpathSync(cwd));
    return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
  } catch { return false; }
}

/** Read a canonical positive PID from a pid file, or return null. */
function readPidFile(pidFile) {
  if (!pidFile) return null;
  try {
    const raw = String(fs.readFileSync(pidFile, "utf8")).trim();
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const pid = Number(raw);
    return Number.isSafeInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Fail closed when a cloudflared process cannot be tied to this installation.
 * Owned only when its PID matches this install's `cloudflared.pid` file (or
 * explicit `cloudflaredPid`) or its `--url` targets `appPort` on loopback.
 */
function ownsCloudflared(pid, command, options = {}) {
  if (!isCloudflaredProcess(command)) return false;
  const numericPid = Number(pid);
  if (Number.isSafeInteger(numericPid) && numericPid > 0) {
    if (Number.isSafeInteger(Number(options.cloudflaredPid)) && Number(options.cloudflaredPid) === numericPid) {
      return true;
    }
    const pidFile = options.cloudflaredPidFile
      || (options.dataDir ? path.join(options.dataDir, "tunnel", "cloudflared.pid") : null);
    if (pidFile) {
      const readPid = options.readPidFile || readPidFile;
      if (readPid(pidFile) === numericPid) return true;
    }
  }
  const portStr = options.appPort == null ? "" : String(options.appPort).trim();
  if (/^[1-9]\d*$/.test(portStr)) {
    const urlPattern = new RegExp(
      `(?:^|\\s)--url(?:=|\\s+)["']?(?:https?:\\/\\/)?(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${portStr}(?:\\/|["'\\s]|$)`,
      "i",
    );
    if (urlPattern.test(String(command || ""))) return true;
  }
  return false;
}

function normalizePathForCompare(value, platform) {
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const raw = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  const normalized = pathImpl.normalize(platform === "win32" ? raw.replace(/\//g, "\\") : raw);
  const root = pathImpl.parse(normalized).root;
  const trimmed = normalized === root ? normalized : normalized.replace(/[\\/]+$/, "");
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function isPathWithin(target, baseDir, platform) {
  const effectivePlatform = platform
    || (/^[a-z]:[\\/]/i.test(String(target || "")) || /^[a-z]:[\\/]/i.test(String(baseDir || ""))
      ? "win32"
      : process.platform);
  const pathImpl = effectivePlatform === "win32" ? path.win32 : path.posix;
  const check = (candidatePath, dirPath) => {
    const normTarget = normalizePathForCompare(candidatePath, effectivePlatform);
    const normBase = normalizePathForCompare(dirPath, effectivePlatform);
    if (!normTarget || !normBase) return false;
    if (!pathImpl.isAbsolute(normTarget) || !pathImpl.isAbsolute(normBase)) return false;
    const rel = pathImpl.relative(normBase, normTarget);
    return rel === "" || (!rel.startsWith(".." + pathImpl.sep) && rel !== ".." && !pathImpl.isAbsolute(rel));
  };
  if (check(target, baseDir)) return true;
  if (effectivePlatform === process.platform) {
    try {
      return check(fs.realpathSync(target), fs.realpathSync(baseDir));
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Fail closed when a systray helper binary cannot be tied to this installation.
 * Owned only when the tray executable lives under this installation's directory
 * (`installDir`, `dataDir`, `appDir`, or explicit `trayDirs`).
 */
function ownsTrayProcess(command, options = {}, platform) {
  const trayPath = extractTrayBinaryPath(command);
  if (!trayPath) return false;
  const allowedDirs = [
    ...(Array.isArray(options.trayDirs) ? options.trayDirs : []),
    options.installDir,
    options.dataDir,
    options.appDir,
  ].filter(Boolean);
  if (allowedDirs.length === 0) return false;
  const effectivePlatform = platform || options.platform;
  return allowedDirs.some((dir) => isPathWithin(trayPath, dir, effectivePlatform));
}

/**
 * Pids of this app's leftovers, verified: the pid is alive, its command line
 * still looks like ours (so a recycled pid is not mistaken for one of them),
 * and shared/generic binaries (`next-server`, `cloudflared`, `tray_*`) pass
 * installation ownership checks.
 *
 * `options` supports ownership bounds (`appDir`, `installDir`, `dataDir`,
 * `appPort`, `cloudflaredPid`, `cloudflaredPidFile`, `trayDirs`) and test
 * overrides (`processes`, `readCommand`, `exclude`, `ownsNextServer`,
 * `ownsCloudflared`, `ownsTrayProcess`, `readPidFile`, `platform`).
 */
function collectAppPids(options = {}) {
  const readCommandImpl = options.readCommand || readCommand;
  const exclude = options.exclude || ownProcessChain(options.selfPid === undefined ? process.pid : options.selfPid, options.parentLookup);
  let rows;
  try {
    rows = options.processes || readProcessTable();
  } catch {
    return [];
  }

  const pids = [];
  for (const row of rows) {
    if (!isAppProcess(row.command) || exclude.has(row.pid)) continue;
    const live = readCommandImpl(row.pid);
    if (live === null || !isAppProcess(live)) continue;
    if (isNextServerProcess(live) &&
        !(options.ownsNextServer || ownsNextServer)(row.pid, options.appDir, live)) continue;
    if (isCloudflaredProcess(live) &&
        !(options.ownsCloudflared || ownsCloudflared)(row.pid, live, options)) continue;
    if (isTrayProcess(live) &&
        !(options.ownsTrayProcess || ownsTrayProcess)(live, options)) continue;
    if (isLauncherProcess(live) && !launcherOwnedByInstall(live, options)) continue;
    pids.push(row.pid);
  }
  return pids;
}

/**
 * The pid to free a port from, or why we will not touch it.
 *
 * A port occupant is a *listener*. A client with an established connection to
 * that port (a supervisor's health probe, say) is not one, and our own process
 * tree is never a target — killing the thing that launched us is how a
 * supervisor dies. `lsof -ti:${port}` (no LISTEN filter, first line only) used
 * to hand us exactly those pids.
 */
function portOccupantToKill(candidate, chain = ownProcessChain()) {
  const pid = Number(candidate);
  if (!Number.isInteger(pid) || pid <= 1) return { pid: null, reason: "none" };
  if (chain.has(pid)) return { pid: null, reason: "own-process-tree" };
  return { pid, reason: "ok" };
}

/** SIGKILL (or `taskkill /F`), best effort — a pid that vanished is not an error. */
function killAppPids(pids) {
  // Freeze all verified targets before killing any, so a parent cannot restart a child.
  if (process.platform !== "win32") {
    for (const pid of pids) {
      try { process.kill(pid, "SIGSTOP"); } catch { /* already dead */ }
    }
  }
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
      } else {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      }
    } catch {
      // Do not leave a still-live process suspended if the kill failed.
      if (process.platform !== "win32") {
        try { process.kill(pid, "SIGCONT"); } catch { /* already dead */ }
      }
    }
  }
  return pids.length;
}

module.exports = {
  APP_PROCESS_IDENTIFIERS,
  isAppProcess,
  isCloudflaredProcess,
  isTrayProcess,
  isLauncherProcess,
  launcherOwnedByInstall,
  ownsNextServer,
  ownsCloudflared,
  ownsTrayProcess,
  looksLikeNode,
  parseProcessTable,
  parseWindowsProcessTable,
  readProcessTable,
  readCommand,
  readPidFile,
  ownProcessChain,
  portOccupantToKill,
  collectAppPids,
  killAppPids,
  maxAncestors: MAX_ANCESTORS,
};
