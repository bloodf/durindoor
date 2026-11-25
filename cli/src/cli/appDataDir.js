const fs = require("fs");
const os = require("os");
const path = require("path");

// The CLI build copies the shared resolver beside this file for published packages.
const sharedResolver = path.join(__dirname, "dataDir.cjs");
const { ensurePrivateDir } = require(fs.existsSync(sharedResolver)
  ? sharedResolver : "../../../src/lib/updater/dataDir.cjs");

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

  const protect = (dir) => ensurePrivateDir(dir, { platform, mkdir, chmod, stat, warn });

  const configured = env.DATA_DIR;
  if (!configured) {
    try {
      protect(fallback);
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
    protect(resolved);
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
