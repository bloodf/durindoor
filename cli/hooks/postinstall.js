#!/usr/bin/env node

// Postinstall only checks existing runtime dependencies. It never installs them;
// normal CLI startup can still prepare missing dependencies when needed.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false, allowInstall: false });
} catch (e) {
  console.warn(`[durindoor] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false, allowInstall: false });
} catch (e) {
  console.warn(`[durindoor] tray runtime skipped: ${e.message}`);
}

process.exit(0);
