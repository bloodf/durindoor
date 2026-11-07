// Lazy install systray2 for macOS/Linux into USER_DATA_DIR/runtime/node_modules.
// Windows uses PowerShell NotifyIcon (no binary) → no systray needed.
// This keeps the published npm tarball free of unsigned Go binaries that
// trigger antivirus false positives (e.g. Kaspersky flagging tray_windows.exe).
//
// We use the maintained `systray2` fork. The original `systray@1.0.5` package
// bundles a 2017 x86_64 Go binary whose Mach-O headers are rejected by modern
// dyld (macOS 14+), so the tray silently fails to register on Apple Silicon.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getRuntimeDir, getRuntimeNodeModules, runNpmInstall, summarizeNpmError } = require("./sqliteRuntime");

const SYSTRAY_PKG = "systray2";
const SYSTRAY_VERSION = "2.1.4";
const LEGACY_SYSTRAY_PKG = "systray";

// Match the tray consumer's resolution order. Loading the real export avoids
// treating a stray package.json as an installed tray implementation.
function findSystray() {
  const runtime = getRuntimeNodeModules();
  for (const [name, inRuntime] of [
    [path.join(runtime, SYSTRAY_PKG), true],
    [SYSTRAY_PKG, false],
    [LEGACY_SYSTRAY_PKG, false],
    [path.join(runtime, LEGACY_SYSTRAY_PKG), true],
  ]) {
    try {
      if (require(name).default) return { name, inRuntime };
    } catch {}
  }
  return null;
}

// Remove an unloadable legacy runtime copy before repairing user-owned deps.
// Installed package payloads may be immutable and are never removed here.
function cleanupLegacySystray({ silent = false } = {}) {
  const targets = [
    path.join(getRuntimeNodeModules(), LEGACY_SYSTRAY_PKG)
  ];
  for (const dir of targets) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        if (!silent) console.log(`[durindoor][runtime] removed legacy systray: ${dir}`);
      } catch (e) {
        if (!silent) console.warn(`[durindoor][runtime] failed to remove ${dir}: ${e.message}`);
      }
    }
  }
}

// systray2's npm tarball sometimes ships the bundled Go binary without the
// executable bit set on macOS, causing spawn() to fail with EACCES. Set +x
// best-effort so the tray actually starts.
function chmodSystrayBin({ silent = false } = {}) {
  if (process.platform === "win32") return;
  const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
  const binPath = path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "traybin", binName);
  if (!fs.existsSync(binPath)) return;
  try {
    fs.chmodSync(binPath, 0o755);
  } catch (e) {
    if (!silent) console.warn(`[durindoor][runtime] chmod tray bin failed: ${e.message}`);
  }
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "9router-runtime",
      version: "1.0.0",
      private: true
    }, null, 2));
  }
  return dir;
}

function npmInstall(pkgs, { silent = false } = {}) {
  const cwd = ensureRuntimeDir();
  if (!silent) console.log("⏳ Installing system tray (first run)...");
  const res = runNpmInstall({ cwd, pkgs, extraArgs: ["--no-save"], timeout: 120000 });
  if (!res.ok && !silent) {
    const reason = summarizeNpmError(res.stderr);
    console.warn("⚠️  System tray install failed — tray disabled");
    console.warn(`   Reason: ${reason}`);
    console.warn(`   Retry:  cd "${cwd}" && npm install ${pkgs.join(" ")}`);
  }
  return res.ok;
}

// Public: ensure systray2 is installed on macOS/Linux only.
// Windows skips entirely (uses PowerShell tray).
function ensureTrayRuntime({ silent = false } = {}) {
  if (process.platform === "win32") {
    return { systray: false, skipped: true };
  }
  const installed = findSystray();
  if (installed) {
    // Only repair the existing user runtime binary, never a package/store path.
    if (installed.inRuntime && installed.name === path.join(getRuntimeNodeModules(), SYSTRAY_PKG)) {
      chmodSystrayBin({ silent });
    }
    if (!silent) console.log("✅ System tray ready");
    return { systray: true };
  }
  cleanupLegacySystray({ silent });
  const ok = npmInstall([`${SYSTRAY_PKG}@${SYSTRAY_VERSION}`], { silent });
  if (ok) chmodSystrayBin({ silent });
  return { systray: ok && Boolean(findSystray()) };
}

module.exports = { ensureTrayRuntime };
