import fs from "fs";
import path from "path";
import { execFileSync, spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { findHeadroomBinary, HEADROOM_COMPRESSION_EXTRAS, getInstalledHeadroomExtras } from "./detect.js";
import { ensureManagedVenv, managedVenvBinary } from "./pythonEnv.js";
import { createDiagnostic, quoteShellArg, redactSensitive, SetupError } from "@/shared/utils/setupDiagnostics.js";
import { isNumber } from "../../shared/utils/typeChecks.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;
// The `ml` extra downloads torch, so a legitimate install is minutes long; the
// bound exists only so a wedged pip cannot hang the request forever.
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const INSTALL_KILL_GRACE_MS = 5000;

let installInFlight = null;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch {/* ignore */}
  return null;
}

function writePid(pid) {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

// Never delete a PID file rewritten by a newer managed-proxy start.
function clearPid(expectedPid = null) {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    if (expectedPid !== null && readPid() !== expectedPid) return;
    fs.unlinkSync(PID_FILE);
  } catch {/* ignore */}
}

/** Await bounded TERM→KILL shutdown, returning true only after observed death. */
async function awaitPidDeath(pid, { termGraceMs = 2000, killWaitMs = 800, pollMs = 100 } = {}) {
  try { process.kill(pid, "SIGTERM"); } catch { return !isPidAlive(pid); }
  const termDeadline = Date.now() + termGraceMs;
  while (Date.now() < termDeadline && isPidAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (!isPidAlive(pid)) return true;
  try { process.kill(pid, "SIGKILL"); } catch {/* already gone */}
  const killDeadline = Date.now() + killWaitMs;
  while (Date.now() < killDeadline && isPidAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return !isPidAlive(pid);
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || !isNumber(pid)) return false;
  try {process.kill(pid, 0);return true;} catch {return false;}
}

export function getManagedPid() {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

/**
 * Start the managed Headroom proxy with CPU-heavy Kompress disabled unless
 * explicitly enabled by a caller.
 *
 * @param {{port?: number, kompress?: boolean}} [options] Proxy launch options.
 */
export async function startHeadroomProxy({ port = DEFAULT_PORT, kompress = false } = {}) {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const managedBinary = managedVenvBinary("headroom");
  const binary = managedBinary || findHeadroomBinary();
  const source = managedBinary ? "managed" : binary ? "path" : null;
  if (!binary) {
    throw new SetupError(createDiagnostic({
      code: "NOT_INSTALLED",
      summary: "No usable Headroom CLI was found",
      detail: "The managed Headroom virtualenv has no headroom binary and no Headroom CLI was found on PATH.",
      fixes: [{ label: "Install Headroom with the required compression extras from the dashboard" }]
    }));
  }

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true, source };

  ensureDir();
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");

  let child;
  try {
    child = spawn(binary, ["proxy", "--port", String(safePort), ...(kompress ? [] : ["--disable-kompress"])], {
      stdio: ["ignore", outFd, outFd],
      detached: true,
      windowsHide: true,
      env: { ...process.env }
    });
  } catch (error) {
    try { fs.closeSync(outFd); } catch {/* already closed */}
    const err = new Error(error?.message || "Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  if (!child.pid) {
    fs.closeSync(outFd);
    const err = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);

  // Wait until the process either stays alive briefly (success) or exits fast (failure).
  await new Promise((resolve, reject) => {
    let settled = false;
    let startupTimer;
    const closeOnce = () => {
      try { fs.closeSync(outFd); } catch {/* already closed */}
    };
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      clearTimeout(startupTimer);
      closeOnce();
      callback(value);
      return true;
    };
    const startupFailure = (detail) => new SetupError(createDiagnostic({
      code: "EARLY_EXIT",
      summary: "Headroom proxy exited during startup",
      detail,
      fixes: [{ label: "Inspect the Headroom proxy log", command: `tail -n 40 ${quoteShellArg(LOG_FILE)}` }],
      logTail: redactSensitive(getHeadroomLogTail(40))
    }));
    const onExit = (code) => {
      if (finish(reject, startupFailure(`The proxy process exited with code ${code}.`))) clearPid(child.pid);
    };
    const onError = (error) => {
      const err = new Error(error?.message || "Failed to spawn headroom proxy");
      err.code = error?.code || "SPAWN_FAILED";
      if (finish(reject, err)) clearPid(child.pid);
    };
    startupTimer = setTimeout(() => {
      child.removeListener("exit", onExit);
      if (isPidAlive(child.pid)) {
        finish(resolve);
        return;
      }
      if (finish(reject, startupFailure(`The proxy process ${child.pid} was no longer running after ${STARTUP_TIMEOUT_MS}ms.`))) {
        clearPid(child.pid);
      }
    }, STARTUP_TIMEOUT_MS);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  const spawnedPid = child.pid;
  child.once("exit", () => {
    try { if (!isPidAlive(spawnedPid)) clearPid(spawnedPid); } catch {/* ignore late cleanup */}
  });

  // Parent fd was closed after startup resolution.

  return { pid: child.pid, alreadyRunning: false, source };
}

export async function stopHeadroomProxy() {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  const stopped = await awaitPidDeath(pid);
  if (!stopped) {
    const err = new Error(`Failed to stop headroom proxy (pid ${pid} still alive) — see proxy.log`);
    err.code = "STOP_FAILED";
    throw err;
  }
  clearPid(pid);
  return { stopped: true, pid };
}

export function getHeadroomLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {return "";}
}

/**
 * Install Headroom and selected compression extras in DurinDoor's managed venv.
 *
 * Passing no extras installs the FULL default set, not just `proxy`: a
 * proxy-only install is what left `code` and `ml` permanently missing, and a
 * caller that asks for "extras" and receives none is the bug, not a feature.
 * Pass an explicit subset to narrow it.
 *
 * @param {string[]} [extras] Compression extras; defaults to every supported extra.
 * @returns {Promise<object>} The re-probed managed-install status.
 * @throws {SetupError} PEP668 | EXTRA_WHEEL_UNAVAILABLE | INSTALL_TIMEOUT | INSTALL_FAILED
 */
export async function installHeadroomExtras(extras) {
  if (installInFlight) return installInFlight;

  const install = (async () => {
    const candidates = Array.isArray(extras) && extras.length > 0 ? extras : HEADROOM_COMPRESSION_EXTRAS;
    const unknowns = candidates.filter((extra) => !HEADROOM_COMPRESSION_EXTRAS.includes(extra));
    if (unknowns.length) {
      throw new SetupError(createDiagnostic({
        code: "UNKNOWN_EXTRA",
        summary: `Unknown Headroom extra name(s): ${unknowns.join(", ")}`,
        detail: `Valid extras are: ${HEADROOM_COMPRESSION_EXTRAS.join(", ")}. An empty array installs every extra; any non-empty array must list only known names.`,
        fixes: [{ label: "Retry with only supported Headroom extras" }]
      }));
    }
    const requested = candidates;
    const { python } = await ensureManagedVenv();
    const spec = `headroom-ai[${["proxy", ...requested].join(",")}]`;
    const args = ["-m", "pip", "install", "--upgrade", spec];
    const installLog = path.join(HEADROOM_DIR, "install.log");

    ensureDir();
    assertInstallDiskSpace(requested, python);
    // pip unpacks wheels through TMPDIR, which on many hosts is a small tmpfs
    // (4 GB here) while the venv lives on a large disk. The `ml` extra pulls
    // torch plus a CUDA stack of roughly 5 GB, so leaving TMPDIR alone fails
    // with ENOSPC after downloading gigabytes. Keep the scratch space on the
    // same filesystem as the venv.
    const scratchDir = path.join(HEADROOM_DIR, "pip-tmp");
    fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
    const outFd = fs.openSync(installLog, "a");
    const manualCommand = [python, ...args].map(quoteShellArg).join(" ");
    // Classify on the RAW log and redact only what is handed out: the markers
    // classification looks for ("externally-managed-environment") are exactly
    // the kind of long hyphenated runs a redactor can eat.
    const failInstall = (reason) => createInstallError({ python, requested, manualCommand, reason, rawLog: getLogTail(installLog, 40) });

    let child;
    try {
      child = spawn(python, args, {
        stdio: ["ignore", outFd, outFd],
        windowsHide: true,
        env: { ...process.env, TMPDIR: scratchDir, PIP_CACHE_DIR: path.join(scratchDir, "cache") }
      });
    } catch (error) {
      try { fs.closeSync(outFd); } catch {/* already closed */}
      throw error;
    }

    return new Promise((resolve, reject) => {

      let settled = false;
      let timeoutTimer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        try {fs.closeSync(outFd);} catch {/* already closed */}
        fn(value);
      };

      timeoutTimer = setTimeout(() => {
        try {child.kill("SIGTERM");} catch {/* already gone */}
        const killTimer = setTimeout(() => {
          try {child.kill("SIGKILL");} catch {/* already gone */}
        }, INSTALL_KILL_GRACE_MS);
        killTimer.unref?.();
        finish(reject, new SetupError(createDiagnostic({
          code: "INSTALL_TIMEOUT",
          summary: `Headroom install exceeded ${Math.round(INSTALL_TIMEOUT_MS / 60000)} minutes and was stopped`,
          detail: `${manualCommand} did not finish within ${INSTALL_TIMEOUT_MS} ms. A slow or blocked package index is the usual cause; the ml extra downloads torch.`,
          fixes: [
          { label: "Run the install manually and watch its output", command: manualCommand },
          { label: "Or install without the heavy ml extra", command: [python, "-m", "pip", "install", "--upgrade", "headroom-ai[proxy,code]"].map(quoteShellArg).join(" ") }],

          logTail: redactSensitive(getLogTail(installLog, 40))
        })));
      }, INSTALL_TIMEOUT_MS);

      child.once("error", (error) => finish(reject, failInstall(`Pip could not start: ${error.message}`)));
      child.once("exit", (code) => {
        if (code === 0) {
          const status = getInstalledHeadroomExtras(python);
          finish(resolve, { success: true, code, spec, source: "managed", ...status, requestedExtras: requested });
          return;
        }
        finish(reject, failInstall(`Pip install exited with code ${code}.`));
      });
    });
  })();
  installInFlight = install;
  try {
    return await install;
  } finally {
    if (installInFlight === install) installInFlight = null;
  }
}

function getLogTail(file, maxLines) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

// The `ml` extra is torch plus an NVIDIA CUDA wheel stack: the resulting venv
// measures about 5.4 GB, and pip needs room for the download and the unpack on
// top of that. Checking first turns a multi-gigabyte download that dies with
// ENOSPC into an instant, actionable refusal.
const ML_REQUIRED_BYTES = 12 * 1024 * 1024 * 1024;
const BASE_REQUIRED_BYTES = 1024 * 1024 * 1024;

function availableBytes(target) {
  try {
    const stat = fs.statfsSync(target);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

function formatGiB(bytes) {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

/**
 * Refuse an install that cannot fit before pip downloads anything.
 *
 * @param {string[]} requested Extras being installed.
 * @param {string} python Managed venv interpreter path.
 * @throws {SetupError} INSTALL_DISK_FULL when the venv filesystem is too small.
 */
function assertInstallDiskSpace(requested, python) {
  const needed = requested.includes("ml") ? ML_REQUIRED_BYTES : BASE_REQUIRED_BYTES;
  const free = availableBytes(HEADROOM_DIR);
  if (free === null || free >= needed) return;
  throw new SetupError(createDiagnostic({
    code: "INSTALL_DISK_FULL",
    summary: `Not enough free space to install the ${requested.join(" and ")} extras`,
    detail: `${HEADROOM_DIR} has ${formatGiB(free)} available; ${requested.includes("ml") ? "the ml extra (torch plus the CUDA wheel stack) needs about" : "the install needs about"} ${formatGiB(needed)} including pip's unpack space.`,
    fixes: [
    { label: "Check free space on the data directory's filesystem", command: `df -h ${quoteShellArg(HEADROOM_DIR)}` },
    { label: "Install without the large ml extra", command: `${quoteShellArg(python)} -m pip install --upgrade ${quoteShellArg("headroom-ai[proxy,code]")}` },
    { label: "Or point DATA_DIR at a larger filesystem and restart DurinDoor" }]

  }));
}

export { quoteShellArg } from "@/shared/utils/setupDiagnostics.js";

function createInstallError({ python, requested, manualCommand, reason, rawLog }) {
  // Match on rawLog; only the redacted copy ever leaves the process.
  const logTail = redactSensitive(rawLog);

  // Observed for real: the ml extra died with ENOSPC after downloading several
  // gigabytes because pip unpacked through a 4 GB /tmp tmpfs while the venv sat
  // on a 148 GB disk. "Installation did not complete" told the operator nothing.
  if (/No space left on device|Errno 28/i.test(rawLog)) {
    const dir = path.dirname(path.dirname(python));
    return new SetupError(createDiagnostic({
      code: "INSTALL_DISK_FULL",
      summary: "Pip ran out of disk space while installing Headroom",
      detail: `The install wrote to ${dir} and unpacked through the scratch directory beside it. The ml extra needs roughly 12 GiB across download, unpack and the final venv.`,
      fixes: [
      { label: "Check free space on the data directory's filesystem", command: `df -h ${quoteShellArg(dir)}` },
      { label: "Install without the large ml extra", command: `${quoteShellArg(python)} -m pip install --upgrade ${quoteShellArg("headroom-ai[proxy,code]")}` },
      { label: "Or point DATA_DIR at a larger filesystem and restart DurinDoor" }],

      logTail
    }));
  }

  if (/externally-managed-environment/i.test(rawLog)) {
    return new SetupError(createDiagnostic({
      code: "PEP668",
      summary: "Pip reported an externally managed Python environment",
      detail: `The managed virtualenv at ${path.dirname(path.dirname(python))} exists precisely to avoid PEP 668. This output means managed venv creation was skipped.`,
      fixes: [{ label: "Recreate the managed Headroom virtualenv, then retry the install", command: `rm -rf ${quoteShellArg(path.dirname(path.dirname(python)))}` }],
      logTail
    }));
  }

  if (/No matching distribution|Could not find a version/i.test(rawLog)) {
    const version = getPythonVersion(python);
    return new SetupError(createDiagnostic({
      code: "EXTRA_WHEEL_UNAVAILABLE",
      summary: "A requested Headroom extra has no compatible package wheel",
      detail: `Pip using ${version} could not resolve one of the requested extras: ${requested.join(", ") || "none"}.`,
      fixes: [
      { label: "Install a different Python minor version with venv support", command: "sudo apt install -y python3.13 python3.13-venv" },
      { label: "Install Headroom without compression extras", command: `${quoteShellArg(python)} -m pip install --upgrade ${quoteShellArg("headroom-ai[proxy]")}` }],

      logTail
    }));
  }

  return new SetupError(createDiagnostic({
    code: "INSTALL_FAILED",
    summary: "Headroom installation did not complete",
    detail: reason,
    fixes: [{ label: "Run the failed install command manually", command: manualCommand }],
    logTail
  }));
}

function getPythonVersion(python) {
  try {
    return `Python ${execFileSync(python, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    }).toString().trim()}`;
  } catch {
    return python;
  }
}