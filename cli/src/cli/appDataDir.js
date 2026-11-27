const fs = require("fs");
const os = require("os");
const path = require("path");

// The installed launcher keeps the shared data-directory module in its app bundle.
const dataDirPath = fs.existsSync(path.join(__dirname, "../../app/src/lib/updater/dataDir.cjs"))
  ? "../../app/src/lib/updater/dataDir.cjs" : "../../../src/lib/updater/dataDir.cjs";
const { ensurePrivateDir, resolveDataDirWith } = require(dataDirPath);

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
  const protect = (dir) => ensurePrivateDir(dir, { platform, mkdir, chmod, stat, warn });
  return resolveDataDirWith({
    env, platform, homedir, cwd, warn, ensureDir: protect, ensureDefault: protect,
  });
}

function getGlobalMitmStateDir({ platform = process.platform, userInfo = os.userInfo } = {}) {
  const homedir = userInfo().homedir;
  return platform === "win32"
    ? path.win32.join(homedir, "AppData", "Local", "DurinDoor", "mitm-state")
    : path.join(homedir, ".durindoor-mitm-state");
}

module.exports = { getAppDataDir, getGlobalMitmStateDir };
