const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_NAME = "9router";
const DIR_MODE = 0o700;

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

/** Create owner-only and repair permissions only when the current user owns the directory. */
function ensurePrivateDir(dir, {
  platform = process.platform,
  mkdir = fs.mkdirSync,
  stat = fs.statSync,
  chmod = fs.chmodSync,
  getuid = process.getuid,
  warn = console.warn,
} = {}) {
  mkdir(dir, { recursive: true, mode: DIR_MODE });
  if (platform === "win32") return;
  try {
    const info = stat(dir);
    if (getuid && info.uid === getuid() && (info.mode & 0o777) !== DIR_MODE) {
      chmod(dir, DIR_MODE);
      warn(`[DATA_DIR] Tightened permissions on '${dir}' to 0700`);
    }
  } catch {
    // Permission repair is best-effort.
  }
}

function resolveDataDir(isHosted) {
  const configured = process.env.DATA_DIR;
  if (!configured && isHosted()) throw new Error("DATA_DIR is required in hosted mode");
  if (!configured) {
    const dir = defaultDir();
    try {
      ensurePrivateDir(dir);
    } catch {
      // A real failure surfaces from the next file write instead.
    }
    return dir;
  }

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    if (isHosted()) throw new Error("Invalid DATA_DIR for Windows in hosted mode");
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  const resolved = path.resolve(configured);
  try {
    /** Upstream PR #3381: newly configured credential directories start owner-only. */
    ensurePrivateDir(resolved);
    if (isHosted()) fs.accessSync(resolved, fs.constants.W_OK);
    return resolved;
  } catch (e) {
    if (isHosted()) throw e;
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${resolved}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}


module.exports = { resolveDataDir, ensurePrivateDir };
