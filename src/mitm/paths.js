const fs = require("fs");
const path = require("path");
// Shared precedence and fallback rules; see the contract in dataDir.cjs.
const { resolveDataDirWith } = require("../lib/updater/dataDir.cjs");

// MITM keeps its own directory policy: create a configured DATA_DIR without
// changing modes, and never create or chmod the default directory. The MITM
// server may run elevated, where owner-only repair would target the wrong user.
function getDataDir() {
  return resolveDataDirWith({ ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }) });
}

const DATA_DIR = getDataDir();
const MITM_DIR = path.join(DATA_DIR, "mitm");

module.exports = { DATA_DIR, MITM_DIR };
