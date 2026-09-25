const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR_MODE = 0o700;

/** Match the server data-directory contract, including isolated DATA_DIR. */
function getAppDataDir({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
  cwd = process.cwd,
  mkdir = fs.mkdirSync,
  chmod = fs.chmodSync,
  stat = fs.statSync,
  warn = console.warn,
} = {}) {
  const pathImpl = platform === "win32" ? path.win32 : path;
  const fallback = platform === "win32"
    ? pathImpl.join(env.APPDATA || pathImpl.join(homedir(), "AppData", "Roaming"), "9router")
    : pathImpl.join(homedir(), ".9router");

  /**
   * Create the data dir owner-only (0700) and repair an existing one whose
   * mode is broader. GHSA-2pg2-xm9r-8544 (ported from OmniRoute): a
   * directory created without an explicit mode inherits the process umask
   * (0755 under the common 022), letting other local users read whatever
   * is stored under it. No-op repair on Windows (no POSIX mode bits);
   * repair failures never block startup.
   */
  function ensurePrivateDir(dir) {
    mkdir(dir, { recursive: true, mode: DATA_DIR_MODE });
    if (platform === "win32") return;
    try {
      const current = stat(dir).mode & 0o777;
      if (current & 0o077) chmod(dir, current & ~0o077);
    } catch {
      // best-effort
    }
  }

  const configured = env.DATA_DIR;
  if (!configured) {
    try {
      ensurePrivateDir(fallback);
    } catch {
      // best-effort; a real failure surfaces from the next file write instead
    }
    return fallback;
  }
  if (platform === "win32" && /^\//.test(configured)) {
    warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return fallback;
  }
  const resolved = pathImpl.resolve(cwd(), configured);
  try {
    ensurePrivateDir(resolved);
    return resolved;
  } catch (error) {
    if (error?.code === "EACCES" || error?.code === "EPERM") {
      warn(`[DATA_DIR] '${resolved}' not writable → fallback ~/.9router`);
      return fallback;
    }
    throw error;
  }
}

function getGlobalMitmStateDir({ platform = process.platform, userInfo = os.userInfo } = {}) {
  const homedir = userInfo().homedir;
  return platform === "win32"
    ? path.win32.join(homedir, "AppData", "Local", "DurinDoor", "mitm-state")
    : path.join(homedir, ".durindoor-mitm-state");
}

module.exports = { getAppDataDir, getGlobalMitmStateDir };
