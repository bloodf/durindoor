import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import processExitCodes from "@/shared/constants/processExitCodes";
import { getCachedPassword, loadEncryptedPassword, stopServer } from "@/mitm/manager";
import processScan from "../../cli/src/lib/processScan.js";

const PROCESS_WAIT_MS = 1500;
const { INTENTIONAL_HANDOFF_EXIT_CODE } = processExitCodes;

// The CLI parent treats only this reserved code as an intentional worker
// handoff. Ordinary code-0 exits remain restartable crash/recovery events.
export function scheduleIntentionalHandoffExit(delayMs) {
  setTimeout(() => process.exit(INTENTIONAL_HANDOFF_EXIT_CODE), delayMs);
}

// Stop MITM through its authenticated manager path before killing app workers.
export async function stopMitmForUpdate() {
  await loadEncryptedPassword();
  const password = getCachedPassword();
  await stopServer(password, { preserveDesiredState: true });
}

// PIDs of our leftover processes, from the shared scan: pid-column parsing,
// verified candidates, and never our own process or an ancestor (see
// cli/src/lib/processScan.js — the ancestor rule is what keeps a supervisor alive).
function collectAppPids() {
  return processScan.collectAppPids();
}

// Copy updater.js into DATA_DIR so npm -g can overwrite node_modules safely
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

function resolveBundledUpdaterPath() {
  if (process.env.UPDATER_SCRIPT_PATH && fs.existsSync(process.env.UPDATER_SCRIPT_PATH)) {
    return process.env.UPDATER_SCRIPT_PATH;
  }
  // Production standalone: cwd is binAppDir (see bin/cli.js)
  // Dev: cwd is app/
  const fromCwd = path.join(process.cwd(), "src", "lib", "updater", "updater.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromParent = path.join(process.cwd(), "..", "src", "lib", "updater", "updater.js");
  if (fs.existsSync(fromParent)) return fromParent;
  return fromCwd;
}

function ensureRuntimeUpdater(bundledPath) {
  try {
    if (!bundledPath || !fs.existsSync(bundledPath)) return bundledPath;
    const runtimeDir = path.join(getDataDir(), "runtime", "updater");
    const runtimePath = path.join(runtimeDir, "updater.js");
    if (fs.existsSync(runtimePath)) {
      try {
        if (fs.statSync(bundledPath).size === fs.statSync(runtimePath).size) return runtimePath;
      } catch { /* recopy */ }
    }
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundledPath, runtimePath);
    return runtimePath;
  } catch {
    return bundledPath;
  }
}

// Kill all app-related processes to release file locks (esp. on Windows)
export async function killAppProcesses() {
  await stopMitmForUpdate();
  const pids = collectAppPids();
  processScan.killAppPids(pids);

  if (pids.length > 0) {
    await new Promise(r => setTimeout(r, PROCESS_WAIT_MS));
  }
}

// Resolve npx/9router binary to relaunch after update (cross-platform)
function resolveRelaunchCommand() {
  const isWin = process.platform === "win32";
  // Prefer `npx 9router` — works regardless of global bin path changes after npm i -g
  const npx = isWin ? "npx.cmd" : "npx";
  return { cmd: npx, args: [UPDATER_CONFIG.npmPackageName] };
}

// Spawn detached headless updater (Node process) then exit current server
export function spawnUpdaterAndExit(packageName = UPDATER_CONFIG.npmPackageName) {
  const updaterPath = ensureRuntimeUpdater(resolveBundledUpdaterPath());
  const isTray = process.env.TRAY_MODE === "1";
  const relaunch = resolveRelaunchCommand();
  const appPort = String(process.env.PORT || UPDATER_CONFIG.appPort);
  // Relaunch matching original env: tray stays tray, foreground stays foreground
  const relaunchArgs = isTray
    ? [...relaunch.args, "--tray", "--skip-update", "--port", appPort]
    : [...relaunch.args, "--skip-update", "--port", appPort];

  spawn(process.execPath, [updaterPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      UPDATER_PKG_NAME: packageName,
      UPDATER_PORT: String(UPDATER_CONFIG.statusPort),
      UPDATER_TAIL_LINES: String(UPDATER_CONFIG.statusLogTailLines),
      UPDATER_RETRIES: String(UPDATER_CONFIG.installRetries),
      UPDATER_RETRY_DELAY_MS: String(UPDATER_CONFIG.installRetryDelayMs),
      UPDATER_LINGER_MS: String(UPDATER_CONFIG.lingerAfterDoneMs),
      UPDATER_WAIT_MIN_MS: String(UPDATER_CONFIG.waitForExitMinMs),
      UPDATER_WAIT_MAX_MS: String(UPDATER_CONFIG.waitForExitMaxMs),
      UPDATER_WAIT_CHECK_MS: String(UPDATER_CONFIG.waitForExitCheckMs),
      // Prefer live server port so wait/relaunch match instance (not hardcoded default)
      UPDATER_APP_PORT: appPort,
      UPDATER_RELAUNCH: "1",
      UPDATER_RELAUNCH_CMD: relaunch.cmd,
      UPDATER_RELAUNCH_ARGS: JSON.stringify(relaunchArgs),
    },
  }).unref();

  scheduleIntentionalHandoffExit(UPDATER_CONFIG.exitDelayMs);
}
