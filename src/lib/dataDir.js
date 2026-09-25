import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";
const DIR_MODE = 0o700;

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

/**
 * Best-effort: repair a DATA_DIR whose mode is broader than owner-only.
 * GHSA-2pg2-xm9r-8544 (ported from OmniRoute): a directory created without
 * an explicit mode inherits the process umask (0755 under the common 022),
 * letting every other local user read whatever is stored under DATA_DIR.
 * No-op on Windows (no POSIX mode bits); never throws — a foreign-owned
 * DATA_DIR (e.g. a bind mount) must not block boot. Duplicated (not
 * imported) from db/paths.js's chmodQuiet because that module imports
 * DATA_DIR from this one.
 */
function chmodDirQuiet(dir) {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(dir, DIR_MODE);
  } catch {
    // best-effort
  }
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) {
    const dir = defaultDir();
    if (fs.existsSync(dir)) {
      chmodDirQuiet(dir);
    } else {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      } catch {
        // best-effort; a real failure surfaces from the next file write instead
      }
    }
    return dir;
  }

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  const resolved = path.resolve(configured);
  try {
    /** Upstream PR #3381: newly configured credential directories start owner-only. */
    fs.mkdirSync(resolved, { recursive: true, mode: DIR_MODE });
    chmodDirQuiet(resolved);
    return resolved;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${resolved}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
