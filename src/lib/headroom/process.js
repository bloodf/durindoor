import fs from "fs";
import path from "path";
import { execFileSync, spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { findHeadroomBinary, HEADROOM_COMPRESSION_EXTRAS, getInstalledHeadroomExtras } from "./detect.js";
import { ensureManagedVenv, managedVenvBinary } from "./pythonEnv.js";
import { createDiagnostic, SetupError } from "@/shared/utils/setupDiagnostics.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;
// The `ml` extra downloads torch, so a legitimate install is minutes long; the
// bound exists only so a wedged pip cannot hang the request forever.
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const INSTALL_KILL_GRACE_MS = 5000;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch { /* ignore */ }
  return null;
}

function writePid(pid) {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
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
      fixes: [{ label: "Install Headroom with the required compression extras from the dashboard" }],
    }));
  }

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true, source };

  ensureDir();
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");

  const child = spawn(binary, ["proxy", "--port", String(safePort), ...(kompress ? [] : ["--disable-kompress"])], {
    stdio: ["ignore", outFd, outFd],
    detached: true,
    windowsHide: true,
    env: { ...process.env },
  });

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
    const startupTimer = setTimeout(() => {
      if (isPidAlive(child.pid)) resolve();
      else reject(new SetupError(createDiagnostic({
        code: "EARLY_EXIT",
        summary: "Headroom proxy exited during startup",
        detail: `The proxy process ${child.pid} was no longer running after ${STARTUP_TIMEOUT_MS}ms.`,
        fixes: [{ label: "Inspect the Headroom proxy log", command: `tail -n 40 ${LOG_FILE}` }],
        logTail: getHeadroomLogTail(40),
      })));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      clearPid();
      fs.closeSync(outFd);
      reject(new SetupError(createDiagnostic({
        code: "EARLY_EXIT",
        summary: "Headroom proxy exited during startup",
        detail: `The proxy process exited with code ${code}.`,
        fixes: [{ label: "Inspect the Headroom proxy log", command: `tail -n 40 ${LOG_FILE}` }],
        logTail: getHeadroomLogTail(40),
      })));
    });
  });

  // Close parent's copy of the fd; child retains its own after unref.
  fs.closeSync(outFd);

  return { pid: child.pid, alreadyRunning: false, source };
}

export function stopHeadroomProxy() {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  try {
    process.kill(pid, "SIGTERM");
    // Give it a moment, then force if still alive.
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    const err = new Error(`Failed to stop headroom proxy: ${e.message}`);
    err.code = "STOP_FAILED";
    throw err;
  }
}

export function getHeadroomLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
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
  const candidates = Array.isArray(extras) && extras.length > 0 ? extras : HEADROOM_COMPRESSION_EXTRAS;
  const requested = candidates.filter((extra) => HEADROOM_COMPRESSION_EXTRAS.includes(extra));
  const { python } = await ensureManagedVenv();
  // pip install string is built from a closed set (HEADROOM_COMPRESSION_EXTRAS),
  // so it cannot be poisoned by caller input — the comma-list is a fixed
  // ['proxy', ...requested]. No shell interpolation.
  const spec = `headroom-ai[${["proxy", ...requested].join(",")}]`;
  const args = ["-m", "pip", "install", "--upgrade", spec];
  const installLog = path.join(HEADROOM_DIR, "install.log");

  ensureDir();
  const outFd = fs.openSync(installLog, "a");
  const manualCommand = [python, ...args].map(quoteShellArg).join(" ");
  const failInstall = (reason) => createInstallError({ python, requested, manualCommand, reason, logTail: getLogTail(installLog, 40) });

  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      stdio: ["ignore", outFd, outFd],
      windowsHide: true,
      env: { ...process.env },
    });

    // Single-settle guard: the timer, "error" and "exit" can all fire, and the
    // fd must be closed exactly once.
    let settled = false;
    let timeoutTimer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      try { fs.closeSync(outFd); } catch { /* already closed */ }
      fn(value);
    };

    // The `ml` extra pulls torch, so this is minutes, not seconds — but it must
    // still be bounded, or a wedged pip hangs the request forever.
    timeoutTimer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      // Escalation deliberately outlives finish(): the request rejects now, but
      // a pip that ignores SIGTERM must still be killed.
      const killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }, INSTALL_KILL_GRACE_MS);
      killTimer.unref?.();
      finish(reject, new SetupError(createDiagnostic({
        code: "INSTALL_TIMEOUT",
        summary: `Headroom install exceeded ${Math.round(INSTALL_TIMEOUT_MS / 60000)} minutes and was stopped`,
        detail: `${manualCommand} did not finish within ${INSTALL_TIMEOUT_MS} ms. A slow or blocked package index is the usual cause; the ml extra downloads torch.`,
        fixes: [
          { label: "Run the install manually and watch its output", command: manualCommand },
          { label: "Or install without the heavy ml extra", command: [python, "-m", "pip", "install", "--upgrade", "headroom-ai[proxy,code]"].map(quoteShellArg).join(" ") },
        ],
        logTail: getLogTail(installLog, 40),
      })));
    }, INSTALL_TIMEOUT_MS);

    child.once("error", (error) => finish(reject, failInstall(`Pip could not start: ${error.message}`)));
    child.once("exit", (code) => {
      if (code === 0) {
        const status = getInstalledHeadroomExtras(python);
        finish(resolve, { success: true, code, spec, extras: requested, source: "managed", ...status });
        return;
      }
      finish(reject, failInstall(`Pip install exited with code ${code}.`));
    });
  });
}

function getLogTail(file, maxLines) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function createInstallError({ python, requested, manualCommand, reason, logTail }) {
  if (/externally-managed-environment/i.test(logTail)) {
    return new SetupError(createDiagnostic({
      code: "PEP668",
      summary: "Pip reported an externally managed Python environment",
      detail: `The managed virtualenv at ${path.dirname(path.dirname(python))} exists precisely to avoid PEP 668. This output means managed venv creation was skipped.`,
      fixes: [{ label: "Recreate the managed Headroom virtualenv, then retry the install", command: `rm -rf ${path.dirname(path.dirname(python))}` }],
      logTail,
    }));
  }

  if (/No matching distribution|Could not find a version/i.test(logTail)) {
    const version = getPythonVersion(python);
    return new SetupError(createDiagnostic({
      code: "EXTRA_WHEEL_UNAVAILABLE",
      summary: "A requested Headroom extra has no compatible package wheel",
      detail: `Pip using ${version} could not resolve one of the requested extras: ${requested.join(", ") || "none"}.`,
      fixes: [
        { label: "Install a different Python minor version with venv support", command: "sudo apt install -y python3.13 python3.13-venv" },
        { label: "Install Headroom without compression extras", command: `${quoteShellArg(python)} -m pip install --upgrade ${quoteShellArg("headroom-ai[proxy]")}` },
      ],
      logTail,
    }));
  }

  return new SetupError(createDiagnostic({
    code: "INSTALL_FAILED",
    summary: "Headroom installation did not complete",
    detail: reason,
    fixes: [{ label: "Run the failed install command manually", command: manualCommand }],
    logTail,
  }));
}

function getPythonVersion(python) {
  try {
    return `Python ${execFileSync(python, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).toString().trim()}`;
  } catch {
    return python;
  }
}
