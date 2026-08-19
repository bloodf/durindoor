#!/usr/bin/env node

// Postinstall: warm up SQLite deps into ~/.9router/runtime so normal CLI startup
// never attempts to install the optional native accelerator. Failure is non-fatal.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false, installBetterSqlite: true });
  console.log("[durindoor] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[durindoor] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[durindoor] tray runtime skipped: ${e.message}`);
}

process.exit(0);
