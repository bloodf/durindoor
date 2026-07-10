const fs = require("fs");
const os = require("os");
const path = require("path");

/** Match the server data-directory contract, including isolated DATA_DIR. */
function getAppDataDir({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
  cwd = process.cwd,
  mkdir = fs.mkdirSync,
  warn = console.warn,
} = {}) {
  const pathImpl = platform === "win32" ? path.win32 : path;
  const fallback = platform === "win32"
    ? pathImpl.join(env.APPDATA || pathImpl.join(homedir(), "AppData", "Roaming"), "9router")
    : pathImpl.join(homedir(), ".9router");
  const configured = env.DATA_DIR;
  if (!configured) return fallback;
  if (platform === "win32" && /^\//.test(configured)) {
    warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return fallback;
  }
  const resolved = pathImpl.resolve(cwd(), configured);
  try {
    mkdir(resolved, { recursive: true });
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
