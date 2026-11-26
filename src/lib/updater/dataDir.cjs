// Shared data-directory resolution for the app server, detached updater, CLI
// launcher and MITM process. Keep this file dependency-free: the updater copies
// it next to itself under DATA_DIR/runtime/updater and requires it from there.
//
// Contract (resolveDataDirWith):
//   1. DATA_DIR unset → hosted mode throws; otherwise the platform default
//      (%APPDATA%\9router on Windows, ~/.9router elsewhere), after the
//      caller's optional best-effort `ensureDefault`.
//   2. A Unix-style absolute DATA_DIR on Windows → hosted throws; otherwise
//      warn and use the default without creating it.
//   3. Otherwise DATA_DIR is resolved against cwd() and passed to the
//      caller's `ensureDir`. EACCES/EPERM falls back to the default (warned);
//      hosted mode and any other error rethrow.
// Callers own their directory policy through `ensureDir`/`ensureDefault`:
// app, updater and CLI create owner-only (0700) directories; MITM only mkdirs.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_NAME = "9router";
const DIR_MODE = 0o700;

function pathFor(platform) {
  return platform === "win32" ? path.win32 : path;
}

/** Platform default data directory; used when DATA_DIR is unset or unusable. */
function defaultDataDir({ platform = process.platform, env = process.env, homedir = os.homedir } = {}) {
  const pathImpl = pathFor(platform);
  if (platform === "win32") {
    return pathImpl.join(env.APPDATA || pathImpl.join(homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return pathImpl.join(homedir(), `.${APP_NAME}`);
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

/** Resolve DATA_DIR with the shared precedence and fallback rules; see the file header. */
function resolveDataDirWith({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
  cwd = process.cwd,
  isHosted = () => false,
  ensureDir,
  ensureDefault = null,
  warn = console.warn,
} = {}) {
  const fallback = () => defaultDataDir({ platform, env, homedir });
  const configured = env.DATA_DIR;
  if (!configured && isHosted()) throw new Error("DATA_DIR is required in hosted mode");
  if (!configured) {
    const dir = fallback();
    if (ensureDefault) {
      try {
        ensureDefault(dir);
      } catch {
        // A real failure surfaces from the next file write instead.
      }
    }
    return dir;
  }

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (platform === "win32" && /^\//.test(configured)) {
    if (isHosted()) throw new Error("Invalid DATA_DIR for Windows in hosted mode");
    warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return fallback();
  }

  const resolved = pathFor(platform).resolve(cwd(), configured);
  try {
    ensureDir(resolved);
    return resolved;
  } catch (e) {
    if (isHosted()) throw e;
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      warn(`[DATA_DIR] '${resolved}' not writable → fallback ~/.${APP_NAME}`);
      return fallback();
    }
    throw e;
  }
}

/** App server and detached updater policy: owner-only dirs, writable check when hosted. */
function resolveDataDir(isHosted) {
  return resolveDataDirWith({
    isHosted,
    /** Upstream PR #3381: newly configured credential directories start owner-only. */
    ensureDir: (dir) => {
      ensurePrivateDir(dir);
      if (isHosted()) fs.accessSync(dir, fs.constants.W_OK);
    },
    ensureDefault: (dir) => ensurePrivateDir(dir),
  });
}

module.exports = { resolveDataDir, resolveDataDirWith, defaultDataDir, ensurePrivateDir };
