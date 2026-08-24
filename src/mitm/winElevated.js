import { isFunction } from "@/shared/utils/typeChecks.js";const { execFile, execFileSync } = require("child_process");
const { buildMinimalWindowsEnv, resolveWindowsSystemBinary } = require("./trustedBinaries");

const IS_WIN = process.platform === "win32";
const PRIVILEGED_UNCONFIRMED_EXIT_CODE = 86;

/**
 * Detect if current Windows process has admin rights (no UAC popup needed).
 * Uses `fltmc` (Filter Manager control), which only succeeds when elevated.
 */
function isAdmin({ platform = process.platform, execFileSyncImpl = execFileSync } = {}) {
  if (platform === "win32") {
    try {
      execFileSyncImpl(resolveWindowsSystemBinary("fltmc.exe", { verify: platform === process.platform }), [], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 5000,
        env: buildMinimalWindowsEnv()
      });
      return true;
    } catch {
      return false;
    }
  }
  const realUid = isFunction(process.getuid) ? process.getuid() : null;
  const effectiveUid = isFunction(process.geteuid) ? process.geteuid() : realUid;
  return realUid === 0 || effectiveUid === 0;
}

function wrapElevatedExecError(error, stderr) {
  const wrapped = new Error(stderr || error.message);
  if (Number(error?.code) === PRIVILEGED_UNCONFIRMED_EXIT_CODE ||
  error?.code === "ETIMEDOUT" ||
  error?.killed === true ||
  error?.signal) {
    wrapped.code = "PRIVILEGED_TERMINATION_UNCONFIRMED";
  }
  return wrapped;
}

/**
 * Quote a string safely for PowerShell single-quoted literal.
 */
function quotePs(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildElevatedSupervisorScript(encodedCommand, timeoutMs, {
  powershellPath = resolveWindowsSystemBinary("powershell.exe", { verify: false }),
  taskkillPath = resolveWindowsSystemBinary("taskkill.exe", { verify: false }),
  startDeadlineMs = null
} = {}) {
  if (!/^[A-Za-z0-9+/=]+$/.test(encodedCommand)) throw new Error("Unsafe encoded PowerShell command");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    throw new Error("Invalid elevated command timeout");
  }
  return `
    $ErrorActionPreference = 'Stop'
    $env:PSModulePath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules'
    $env:PATH = (Join-Path $env:SystemRoot 'System32') + ';' + (Join-Path $env:SystemRoot 'System32\\Wbem')
    ${startDeadlineMs == null ? "" : `if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt ${startDeadlineMs}) { throw 'UAC approval deadline expired before privileged mutation began' }`}
    $child = Start-Process ${quotePs(powershellPath)} -ArgumentList @(
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-WindowStyle','Hidden','-EncodedCommand','${encodedCommand}'
    ) -PassThru -WindowStyle Hidden
    if (-not $child.WaitForExit(${timeoutMs})) {
      & ${quotePs(taskkillPath)} /PID $child.Id /T /F | Out-Null
      if (-not $child.WaitForExit(5000)) {
        [Console]::Error.WriteLine("Elevated command process tree could not be terminated")
        exit ${PRIVILEGED_UNCONFIRMED_EXIT_CODE}
      }
      throw "Elevated command timed out after ${timeoutMs}ms"
    }
    if ($child.ExitCode -ne 0) { throw "Elevated command exited with code $($child.ExitCode)" }
  `;
}

/**
 * Run PowerShell script — escalated via UAC popup if not already admin.
 * Returns Promise resolving on exit code 0, rejecting otherwise.
 *
 * IMPORTANT: each call triggers ONE UAC popup. Batch multiple admin tasks
 * into a single script string to minimize popups.
 */
function runElevatedPowerShell(script, { commandTimeoutMs = 30000, uacTimeoutMs = 120000 } = {}) {
  if (!IS_WIN) return Promise.reject(new Error("Windows-only"));

  const powershellPath = resolveWindowsSystemBinary("powershell.exe");
  const taskkillPath = resolveWindowsSystemBinary("taskkill.exe");
  const hardenedScript = `
    $env:PSModulePath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules'
    $env:PATH = (Join-Path $env:SystemRoot 'System32') + ';' + (Join-Path $env:SystemRoot 'System32\\Wbem')
    ${script}
  `;
  const encoded = Buffer.from(hardenedScript, "utf16le").toString("base64");
  const startDeadlineMs = Date.now() + uacTimeoutMs;
  const supervisor = buildElevatedSupervisorScript(encoded, commandTimeoutMs, {
    powershellPath,
    taskkillPath,
    startDeadlineMs
  });
  const encodedSupervisor = Buffer.from(supervisor, "utf16le").toString("base64");
  const childEnv = buildMinimalWindowsEnv();

  // If already admin, run the same bounded supervisor directly — zero popup.
  if (isAdmin()) {
    return new Promise((resolve, reject) => {
      execFile(
        powershellPath,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedSupervisor],
        { windowsHide: true, timeout: commandTimeoutMs + 15000, env: childEnv },
        (error, stdout, stderr) => {
          if (error) reject(wrapElevatedExecError(error, stderr));else
          resolve(stdout);
        }
      );
    });
  }

  // Not admin — elevate only the bounded supervisor. It owns and terminates
  // the entire privileged command tree before returning any timeout.
  const wrapper = `
    $proc = Start-Process ${quotePs(powershellPath)} -ArgumentList @(
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
      '-WindowStyle','Hidden','-EncodedCommand','${encodedSupervisor}'
    ) -Verb RunAs -Wait -PassThru -WindowStyle Hidden;
    if ($proc.ExitCode -eq ${PRIVILEGED_UNCONFIRMED_EXIT_CODE}) { exit ${PRIVILEGED_UNCONFIRMED_EXIT_CODE} }
    if ($proc.ExitCode -ne 0) { throw "Elevated command exited with code $($proc.ExitCode)" }
  `;
  const encodedWrapper = Buffer.from(wrapper, "utf16le").toString("base64");

  return new Promise((resolve, reject) => {
    execFile(
      powershellPath,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedWrapper],
      { windowsHide: true, timeout: uacTimeoutMs + commandTimeoutMs + 15000, env: childEnv },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message;
          if (msg.includes("canceled by the user") || msg.includes("operation was canceled")) {
            reject(new Error("User canceled UAC prompt"));
          } else {
            reject(wrapElevatedExecError(error, stderr));
          }
        } else resolve(stdout);
      }
    );
  });
}

module.exports = {
  buildElevatedSupervisorScript,
  isAdmin,
  runElevatedPowerShell,
  quotePs,
  PRIVILEGED_UNCONFIRMED_EXIT_CODE,
  wrapElevatedExecError
};