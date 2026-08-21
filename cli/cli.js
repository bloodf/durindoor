#!/usr/bin/env node

const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const os = require("os");
const { stopMitmViaManagerSync } = require("./src/cli/mitmManagerStop");
const { getAppDataDir, getGlobalMitmStateDir } = require("./src/cli/appDataDir");
const { waitServerReady } = require("./src/cli/waitServerReady");

// Resolve once before any worker changes cwd. Every CLI helper and the Next
// worker inherit the same absolute path, so database, PID, CA, and auth-token
// state cannot split across process working directories.
process.env.DATA_DIR = getAppDataDir();

// Native spinner - no external dependency
function createSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval = null;
  let currentText = text;
  return {
    start() {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${frames[0]} ${currentText}`);
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[i++ % frames.length]} ${currentText}`);
        }, 80);
      }
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write("\r\x1b[K");
      }
    },
    succeed(msg) {
      this.stop();
      console.log(`✅ ${msg}`);
    },
    fail(msg) {
      this.stop();
      console.log(`❌ ${msg}`);
    }
  };
}

const pkg = require("./package.json");
const args = process.argv.slice(2);

// Configuration constants
const APP_NAME = pkg.name; // Use from package.json
const INSTALL_CMD_LATEST = `npm i -g ${APP_NAME}@latest --prefer-online`;

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "0.0.0.0";

function hasFlag(flag, shortFlag) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag || arg === shortFlag) return true;
    if (["--port", "-p", "--host", "-H"].includes(arg)) i++;
  }
  return false;
}

if (hasFlag("--help", "-h")) {
  console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version
`);
  process.exit(0);
}

if (hasFlag("--version", "-v")) {
  console.log(pkg.version);
  process.exit(0);
}

const { ensureSqliteRuntime, buildEnvWithRuntime } = require("./hooks/sqliteRuntime");
const { buildNodeArgs } = require("./hooks/nodeFlags");
const { ensureTrayRuntime } = require("./hooks/trayRuntime");
const { killByPidFile } = require("./hooks/killByPidFile");


// Verify SQLite runtime deps. Missing sql.js may be repaired because it is the
// required fallback; optional better-sqlite3 installation is postinstall-only so
// ordinary startup never blocks on npm/node-gyp.
try { ensureSqliteRuntime({ silent: true }); } catch {}

// Self-heal tray runtime (systray for macOS/Linux only). Windows skipped.
try { ensureTrayRuntime({ silent: true }); } catch {}

const DISPLAY_NAME = "DurinDoor";
// First non-internal IPv4 — the address remote peers actually reach when bound to 0.0.0.0.
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

// Local URL stays "localhost"; warn separately when bound to all interfaces (network-exposed).
function getDisplayHost() {
  return host === DEFAULT_HOST ? "localhost" : host;
}
const MAX_PORT_ATTEMPTS = 10;
// Identifiers for killAllAppProcesses - only kill 9router specifically
const PROCESS_IDENTIFIERS = [
  '9router'  // Only package name - avoid killing other apps
];

// Parse arguments
let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || DEFAULT_HOST;
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--log" || args[i] === "-l") {
    showLog = true;
  } else if (args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--tray" || args[i] === "-t") {
    trayMode = true;
    process.env.TRAY_MODE = "1";
  }
}

// Auto-relaunch after update: detached process has no TTY → fallback to tray
if (skipUpdate && !trayMode && !process.stdin.isTTY) {
  trayMode = true;
  process.env.TRAY_MODE = "1";
}

// Always use Node.js runtime with absolute path
const RUNTIME = process.execPath;

// Compare semver versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

// Kill tunnel processes (cloudflared/tailscale) by their PID files
function killTunnelByPidFile() {
  const tunnelDir = path.join(getAppDataDir(), "tunnel");
  killByPidFile(path.join(tunnelDir, "cloudflared.pid"));
  killByPidFile(path.join(tunnelDir, "tailscale.pid"));
}

// Kill cloudflared whose --url targets this app's port (covers stale PID file case)
function killCloudflaredByAppPort(appPort) {
  if (!appPort) return [];
  const portMatchers = [`localhost:${appPort}`, `127.0.0.1:${appPort}`];
  const pids = [];
  try {
    if (process.platform === "win32") {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"cloudflared.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: 5000 });
      const lines = output.split("\n").slice(1).filter(l => l.trim());
      lines.forEach(line => {
        if (portMatchers.some(m => line.includes(m))) {
          const match = line.match(/^"(\d+)"/);
          if (match && match[1]) pids.push(match[1]);
        }
      });
    } else {
      const output = execSync("ps -eo pid,command 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      output.split("\n").forEach(line => {
        if (line.includes("cloudflared") && portMatchers.some(m => line.includes(m))) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[0];
          if (pid && !isNaN(pid)) pids.push(pid);
        }
      });
    }
  } catch { }
  return pids;
}

// Kill all 9router processes
function killAllAppProcesses(appPort) {
  return new Promise((resolve, reject) => {
    try {
      const mitmPidFile = path.join(getAppDataDir(), "mitm", ".mitm.pid");
      const managerStopped = stopMitmViaManagerSync(appPort);
      if (!managerStopped && fs.existsSync(mitmPidFile)) {
        reject(new Error("MITM manager cleanup could not be confirmed; refusing to orphan system redirect state"));
        return;
      }
      // Kill Headroom proxy by PID file — detached process that outlives the main server.
      // Must stop before npm rename; it holds a handle on the app/ directory on Windows (#2265).
      killByPidFile(path.join(getAppDataDir(), "headroom", "proxy.pid"));
      // Kill cloudflared/tailscale by PID file (precise, only this app's tunnel)
      killTunnelByPidFile();

      const platform = process.platform;
      let pids = [];

      // Catch stale PID files: kill cloudflared bound to this app's port
      pids.push(...killCloudflaredByAppPort(appPort));

      if (platform === "win32") {
        // Windows: use WMI to get full CommandLine (tasklist /V doesn't include it)
        try {
          const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
          const output = execSync(psCmd, {
            encoding: "utf8",
            windowsHide: true,
            timeout: 5000
          });
          const lines = output.split("\n").slice(1).filter(l => l.trim());
          lines.forEach(line => {
            // Whitelist: real node process running 9router/cli.js, or next-server.
            // Avoids killing editors/grep/strace/cursor that just have "9router" in cmdline.
            const cmd = line.toLowerCase();
            const isAppProcess =
              (cmd.includes("node") && cmd.includes("9router") && (cmd.includes("cli.js") || cmd.includes("\\9router") || cmd.includes("/9router")))
              || cmd.includes("next-server");
            if (isAppProcess) {
              const match = line.match(/^"(\d+)"/);
              if (match && match[1] && match[1] !== process.pid.toString()) {
                pids.push(match[1]);
              }
            }
          });
        } catch (e) {
          // No processes found or error - continue
        }
      } else {
        // macOS/Linux: use ps to find all matching processes
        try {
          const output = execSync('ps aux 2>/dev/null', {
            encoding: 'utf8',
            timeout: 5000
          });
          const lines = output.split('\n');

          lines.forEach(line => {
            // Whitelist: real node process running 9router/cli.js, or next-server.
            // Avoids killing grep/strace/editors/cursor that incidentally match "9router".
            const cmd = line.toLowerCase();
            const isAppProcess =
              (cmd.includes("node") && cmd.includes("9router") && (cmd.includes("cli.js") || cmd.includes("/9router")))
              || cmd.includes("next-server");
            if (isAppProcess) {
              const parts = line.trim().split(/\s+/);
              const pid = parts[1];
              if (pid && !isNaN(pid) && pid !== process.pid.toString()) {
                pids.push(pid);
              }
            }
          });
        } catch (e) {
          // No processes found or error - continue
        }
      }

      // Kill all found processes
      if (pids.length > 0) {
        pids.forEach(pid => {
          try {
            if (platform === "win32") {
              execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
            } else {
              execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
            }
          } catch (err) {
            // Process already dead or can't kill - continue
          }
        });

        // Wait for processes to fully terminate
        setTimeout(() => resolve(), 1000);
      } else {
        resolve();
      }
    } catch (err) {
      // Silent fail - continue anyway
      resolve();
    }
  });
}

// Sleep helper using SharedArrayBuffer wait (sync, no busy-loop)
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

// Kill any process on specific port
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    try {
      const platform = process.platform;
      let pid;

      if (platform === "win32") {
        try {
          const output = execSync(`netstat -ano | findstr :${port}`, {
            encoding: 'utf8',
            shell: true,
            windowsHide: true,
            timeout: 5000
          }).trim();
          const lines = output.split('\n').filter(l => l.includes('LISTENING'));
          if (lines.length > 0) {
            pid = lines[0].trim().split(/\s+/).pop();
            execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
          }
        } catch (e) {
          // Port is free or error
        }
      } else {
        // macOS/Linux
        try {
          const pidOutput = execSync(`lsof -ti:${port}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          if (pidOutput) {
            pid = pidOutput.split('\n')[0];
            execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
          }
        } catch (e) {
          // Port is free or error
        }
      }

      // Wait for port to be released
      setTimeout(() => resolve(), 500);
    } catch (err) {
      // Silent fail - continue anyway
      resolve();
    }
  });
}


// Detect if running in restricted environment (Codespaces, Docker)
function isRestrictedEnvironment() {
  // Check for Codespaces
  if (process.env.CODESPACES === "true" || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return "GitHub Codespaces";
  }

  // Check for Docker
  if (fs.existsSync("/.dockerenv") || (fs.existsSync("/proc/1/cgroup") && fs.readFileSync("/proc/1/cgroup", "utf8").includes("docker"))) {
    return "Docker";
  }

  return null;
}

// Check if new version available, return latest version or null
function checkForUpdate() {
  return new Promise((resolve) => {
    if (skipUpdate) {
      resolve(null);
      return;
    }

    const spinner = createSpinner("Checking for updates...").start();
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        spinner.stop();
        resolve(null);
      }
    }, 8000);

    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      spinner.stop();
      resolve(version);
    };

    const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const latest = JSON.parse(data);
          if (latest.version && compareVersions(latest.version, pkg.version) > 0) {
            done(latest.version);
          } else {
            done(null);
          }
        } catch (e) {
          done(null);
        }
      });
    });

    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
  });
}

// Open browser
function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, { windowsHide: true }, (err) => {
    if (err) {
      console.log(`Open browser manually: ${url}`);
    }
  });
}

// The owner-aware wrapper is mandatory: starting the bare Next server would
// bypass real-peer, anti-spoofing, and privileged-control proof checks.
const standaloneDir = path.join(__dirname, "app");
const customServerPath = path.join(standaloneDir, "custom-server.js");
if (!fs.existsSync(customServerPath)) {
  console.error("Error: owner-aware custom-server.js is missing. Reinstall DurinDoor.");
  process.exit(1);
}
const serverPath = customServerPath;
const { INTENTIONAL_HANDOFF_EXIT_CODE } = require(
  path.join(standaloneDir, "src", "shared", "constants", "processExitCodes.js"),
);
const { isIntentionalWorkerHandoff } = require("./src/cli/workerExit");

function hasStaleMitmOwnership() {
  const mitmDir = path.join(getAppDataDir(), "mitm");
  return fs.existsSync(path.join(mitmDir, ".mitm.pid"))
    || fs.existsSync(path.join(getGlobalMitmStateDir(), "redirect.json"));
}

function waitForWorkerIdentity(child, expectedNonce, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      if (error) reject(error); else resolve();
    };
    const onExit = (code) => finish(new Error(`Recovery worker exited before readiness (code ${code})`));
    child.once("exit", onExit);
    const attempt = () => {
      if (settled) return;
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        method: "GET",
        timeout: 1000,
      }, (res) => {
        const matches = res.statusCode >= 200
          && res.statusCode < 300
          && res.headers["x-durindoor-worker-nonce"] === expectedNonce;
        res.resume();
        res.on("end", () => {
          if (matches) finish();
          else if (Date.now() >= deadline) finish(new Error("Recovery worker identity could not be verified"));
          else setTimeout(attempt, 250);
        });
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() >= deadline) finish(new Error("Recovery worker did not become ready"));
        else setTimeout(attempt, 250);
      });
      req.end();
    };
    attempt();
  });
}

async function recoverStaleMitmOwnershipBeforeStartup() {
  if (!hasStaleMitmOwnership()) return;
  if (stopMitmViaManagerSync(port, { preserveDesiredState: true })) return;

  const nonce = crypto.randomBytes(24).toString("hex");
  const child = spawn(RUNTIME, buildNodeArgs(serverPath, process.env), {
    cwd: standaloneDir,
    // A recovery worker may intentionally outlive this CLI after a failed
    // cleanup. Ignore inherited output so no referenced/fillable pipe can keep
    // the parent alive or stall that retained worker.
    stdio: "ignore",
    detached: true,
    windowsHide: true,
    env: {
      ...buildEnvWithRuntime(process.env),
      PORT: port.toString(),
      HOSTNAME: "127.0.0.1",
      DURINDOOR_WORKER_NONCE: nonce,
    },
  });
  try {
    await waitForWorkerIdentity(child, nonce);
    if (!stopMitmViaManagerSync(port, { preserveDesiredState: true })) {
      throw new Error("Recovery worker could not clean stale MITM ownership");
    }
    try { process.kill(child.pid, "SIGTERM"); } catch { /* already stopped */ }
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* platform/process-group fallback */ }
  } catch (error) {
    child.unref();
    throw new Error(`${error.message}; recovery worker was retained for a safe cleanup retry`);
  }
}

if (!fs.existsSync(serverPath)) {
  console.error("Error: Standalone build not found.");
  console.error("Please run 'npm run build:cli' first.");
  process.exit(1);
}

// Kick off the update check in parallel with cleanup/port-release (not on the
// critical path for server start). MITM/stale-redirect recovery stays sequential
// BEFORE killAllAppProcesses: safety-critical system redirect cleanup.
const updatePromise = checkForUpdate();
(async () => {
  await recoverStaleMitmOwnershipBeforeStartup();
  await killAllAppProcesses(port);
  await killProcessOnPort(port);
  startServer(updatePromise);
})().catch((error) => {
  console.error(`Startup cleanup failed: ${error.message}`);
  process.exitCode = 1;
});

// Show interface selection menu
async function showInterfaceMenu(latestVersion) {
  const { selectMenu } = require("./src/cli/utils/input");
  const { clearScreen } = require("./src/cli/utils/display");
  const { getEndpoint } = require("./src/cli/utils/endpoint");

  clearScreen();

  const displayHost = getDisplayHost();

  // Detect tunnel/local mode for server URL display
  let serverUrl;
  try {
    const { endpoint, tunnelEnabled } = await getEndpoint(port);
    serverUrl = tunnelEnabled ? endpoint.replace(/\/v1$/, "") : `http://${displayHost}:${port}`;
  } catch (e) {
    serverUrl = `http://${displayHost}:${port}`;
  }

  const subtitle = `🚀 Server: \x1b[32m${serverUrl}\x1b[0m`;

  const menuItems = [];

  if (latestVersion) {
    menuItems.push({ label: `Update to v${latestVersion} (current: v${pkg.version})`, icon: "⬆" });
  }

  menuItems.push(
    { label: "Web UI (Open in Browser)", icon: "🌐" },
    { label: "Terminal UI (Interactive CLI)", icon: "💻" },
    { label: "Hide to Tray (Background)", icon: "🔔" },
    { label: "Exit", icon: "🚪" }
  );

  const selected = await selectMenu(`Choose Interface (v${pkg.version})`, menuItems, 0, subtitle);

  const offset = latestVersion ? 1 : 0;

  if (latestVersion && selected === 0) return "update";
  if (selected === offset) return "web";
  if (selected === offset + 1) return "terminal";
  if (selected === offset + 2) return "hide";
  return "exit";
}

const MAX_RESTARTS = 2;
const RESTART_RESET_MS = 30000; // Reset counter if alive > 30s

function startServer(updatePromise) {
  // Accept either a Promise (parallel update check) or a resolved value.
  // Swallow update-check failures: a network blip must never crash startup or
  // surface an unhandled rejection; the existing update menu simply sees null.
  const latestVersionPromise = Promise.resolve(updatePromise).catch(() => null);
  const displayHost = getDisplayHost();
  const url = `http://${displayHost}:${port}/dashboard`;
  // Surface real network exposure when bound to all interfaces (default 0.0.0.0).
  if (host === DEFAULT_HOST) {
    const lanIp = getLanIp();
    if (lanIp) console.log(`\x1b[33m⚠ Network-exposed: reachable at http://${lanIp}:${port} (bound 0.0.0.0). Use --host 127.0.0.1 for local-only.\x1b[0m`);
  }

  let restartCount = 0;
  let serverStartTime = Date.now();
  let recoveryInProgress = false;

  const CRASH_LOG_LINES = 50;
  let crashLog = [];

  function spawnServer(extraEnv = {}) {
    serverStartTime = Date.now();
    crashLog = [];
    const child = spawn(RUNTIME, buildNodeArgs(serverPath, process.env), {
      cwd: standaloneDir,
      stdio: showLog ? "inherit" : ["ignore", "ignore", "pipe"],
      detached: true,
      windowsHide: true,
      env: {
        ...buildEnvWithRuntime(process.env),
        PORT: port.toString(),
        HOSTNAME: host,
        ...extraEnv,
      }
    });
    if (!showLog && child.stderr) {
      child.stderr.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        crashLog.push(...lines);
        if (crashLog.length > CRASH_LOG_LINES) crashLog = crashLog.slice(-CRASH_LOG_LINES);
      });
    }
    return child;
  }

  let server = spawnServer();

  // Cleanup function - force kill server process
  let isCleaningUp = false;
  function cleanup() {
    if (isCleaningUp) return false;
    isCleaningUp = true;
    try {
      const mitmStopped = stopMitmViaManagerSync(port);
      if (!mitmStopped) {
        console.error("MITM manager cleanup could not be confirmed; leaving the app worker alive to preserve system redirect ownership.");
        isCleaningUp = false;
        return false;
      }

      // Kill tray if running
      try {
        const { killTray } = require("./src/cli/tray/tray");
        killTray();
      } catch (e) { }
      // Kill Headroom proxy (detached process, holds handle on app/ on Windows)
      killByPidFile(path.join(getAppDataDir(), "headroom", "proxy.pid"));
      // Kill cloudflared/tailscale via PID file (only this app's tunnel)
      killTunnelByPidFile();
      // Graceful stop so Next.js can flush DB / run its own cleanup
      if (server?.pid) {
        try { process.kill(server.pid, "SIGTERM"); } catch (e) { }
        sleepSync(400);
      }
      // Kill server process directly
      if (server?.pid) {
        try { process.kill(server.pid, "SIGKILL"); } catch (e) { }
      }
      // Also try to kill process group
      if (server?.pid) {
        try { process.kill(-server.pid, "SIGKILL"); } catch (e) { }
      }
      return true;
    } catch (error) {
      console.error(`Cleanup failed: ${error.message}`);
      isCleaningUp = false;
      return false;
    }
  }

  function exitAfterCleanup(code = 0, delayMs = 100) {
    if (!cleanup()) {
      isShuttingDown = false;
      return false;
    }
    setTimeout(() => process.exit(code), delayMs);
    return true;
  }

  // Suppress all errors during shutdown (systray lib throws JSON parse errors)
  let isShuttingDown = false;
  process.on("uncaughtException", (err) => {
    if (isShuttingDown) return;
    console.error("Error:", err.message);
  });

  // Handle all exit scenarios
  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nExiting...");
    exitAfterCleanup(0);
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    exitAfterCleanup(0);
  });
  process.on("SIGHUP", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    exitAfterCleanup(0);
  });

  // Initialize tray icon (runs alongside TUI)
  const initTrayIcon = () => {
    try {
      const { initTray } = require("./src/cli/tray/tray");
      initTray({
        port,
        onQuit: () => {
          isShuttingDown = true;
          console.log("\n👋 Shutting down from tray...");
          exitAfterCleanup(0);
        },
        onOpenDashboard: () => openBrowser(url)
      });
    } catch (err) {
      // Tray not available - continue without it
    }
  };

  // Tray-only mode: no TUI, just tray icon
  if (trayMode) {
    // Ignore SIGHUP so macOS terminal close doesn't kill the background tray process
    process.removeAllListeners("SIGHUP");
    process.on("SIGHUP", () => {});

    console.log(`\n🚀 ${DISPLAY_NAME} v${pkg.version}`);
    console.log(`Server: http://${displayHost}:${port}`);

    waitServerReady(port).then((ready) => {
      initTrayIcon();
      if (ready) {
        console.log("\n💡 Router is now running in system tray. Close this terminal if you want.");
      } else {
        console.log("\n⚠ Server process started; readiness unconfirmed. Tray attached anyway.");
      }
      console.log("   Right-click tray icon to open dashboard or quit.\n");
    });

    return;
  }

  // Wait for server to be ready, then show interface menu loop + tray
  waitServerReady(port).then(async (ready) => {
    if (recoveryInProgress) return;
    if (!ready) {
      // Readiness failed after the deadline: the backend may have crashed and
      // menu actions would hit a dead server. Keep the tray for control, but do
      // not enter the interactive web/TUI loop; server event handlers manage
      // restart/exit.
      console.error("\n✖ Server did not become ready in time; not showing interface menu.");
      console.error("  Check the logs above; the tray icon remains available.");
      initTrayIcon();
      return;
    }
    // Resolve parallel update check (already running); don't block server start on it.
    const latestVersion = await latestVersionPromise;
    // Start tray icon alongside TUI
    initTrayIcon();

    try {
      while (true) {
        const choice = await showInterfaceMenu(latestVersion);

        if (choice === "update") {
          isShuttingDown = true;
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();
          console.log(`\n⬆  Update v${pkg.version} → v${latestVersion}\n`);
          console.log(`Run this after exit:\n`);
          console.log(`   \x1b[33m${INSTALL_CMD_LATEST}\x1b[0m\n`);
          if (!cleanup()) {
            isShuttingDown = false;
            continue;
          }
          await killAllAppProcesses(port);
          await killProcessOnPort(port);
          setTimeout(() => process.exit(0), 200);
          return;
        } else if (choice === "web") {
          openBrowser(url);
          // Wait for user to come back
          const { pause } = require("./src/cli/utils/input");
          await pause("\nPress Enter to go back to menu...");
        } else if (choice === "terminal") {
          // Start Terminal UI - it will return when user selects Back
          const { startTerminalUI } = require("./src/cli/terminalUI");
          await startTerminalUI(port);
          // Loop continues, show menu again
        } else if (choice === "hide") {
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();

          // Enable auto startup on OS boot
          try {
            const { enableAutoStart } = require("./src/cli/tray/autostart");
            enableAutoStart(__filename);
          } catch (e) { }

          if (process.platform === "darwin") {
            // macOS: keep current process alive — spawning a detached child puts
            // it outside the login session so NSStatusItem silently fails.
            process.removeAllListeners("SIGHUP");
            process.on("SIGHUP", () => {});

            console.log(`\n⏳ Switching to tray mode... (icon already visible in menu bar)`);
            console.log(`🔔 ${DISPLAY_NAME} is running in tray (PID: ${process.pid})`);
            console.log(`   Server: http://${displayHost}:${port}`);
            console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

            // Tray already init'd at startup — just keep event loop alive.
            return;
          }

          // Stop the current worker before creating its replacement. If MITM
          // ownership cleanup cannot be confirmed, do not fork and orphan it.
          isShuttingDown = true;
          if (!cleanup()) {
            isShuttingDown = false;
            continue;
          }

          // Windows/Linux: spawn detached bgProcess (systray works fine in child)
          console.log(`\n⏳ Starting background process... (tray icon will appear in ~3s)`);

          const bgProcess = spawn(process.execPath, [__filename, "--tray", "--skip-update", "-p", port.toString()], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: { ...process.env }
          });
          bgProcess.unref();

          console.log(`🔔 ${DISPLAY_NAME} is now running in background (PID: ${bgProcess.pid})`);
          console.log(`   Server: http://${displayHost}:${port}`);
          console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

          process.exit(0);
        } else if (choice === "exit") {
          isShuttingDown = true;
          console.log("\nExiting...");
          exitAfterCleanup(0);
        }
      }
    } catch (err) {
      console.error("Error:", err.message);
      isShuttingDown = true;
      exitAfterCleanup(1, 0);
    }
  });

  function attachServerEvents() {
    server.on("error", (err) => {
      console.error("Failed to start server:", err.message);
      if (recoveryInProgress) return;
      if (!isShuttingDown) tryRestart();
      else if (cleanup()) process.exit(1);
    });

    server.on("close", (code) => {
      if (recoveryInProgress) return;
      if (isIntentionalWorkerHandoff(
        code,
        INTENTIONAL_HANDOFF_EXIT_CODE,
        hasStaleMitmOwnership(),
      )) {
        isShuttingDown = true;
        process.exit(0);
        return;
      }
      if (isShuttingDown) {
        process.exit(code || 0);
        return;
      }
      if (code === INTENTIONAL_HANDOFF_EXIT_CODE) {
        console.error("Intentional worker handoff was rejected because MITM ownership state remains.");
      }
      // A clean Next.js exit is still unexpected at the CLI layer. Restart so
      // the manager can re-adopt or explicitly clean any active MITM state.
      tryRestart(code || 1);
    });
  }

  function tryRestart(code) {
    const aliveMs = Date.now() - serverStartTime;
    // Reset counter if last run was stable
    if (aliveMs >= RESTART_RESET_MS) restartCount = 0;

    if (restartCount >= MAX_RESTARTS) {
      console.error(`\n⚠️  Server crashed ${MAX_RESTARTS} times. Starting one recovery worker to clean MITM system state...`);
      recoveryInProgress = true;
      void recoverAfterRestartExhaustion();
      return;
    }

    restartCount++;
    const delay = Math.min(1000 * restartCount, 10000);
    console.error(`\n⚠️  Server exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
    if (crashLog.length) {
      console.error("\n--- Server crash log ---");
      crashLog.forEach(l => console.error(l));
      console.error("--- End crash log ---\n");
    }

    setTimeout(() => {
      server = spawnServer();
      attachServerEvents();
    }, delay);
  }

  async function recoverAfterRestartExhaustion() {
    try {
      const nonce = crypto.randomBytes(24).toString("hex");
      server = spawnServer({ DURINDOOR_WORKER_NONCE: nonce });
      attachServerEvents();
      await waitForWorkerIdentity(server, nonce);
      if (!stopMitmViaManagerSync(port, { preserveDesiredState: false })) {
        throw new Error("MITM manager cleanup could not be confirmed on the recovery worker");
      }
      console.error("MITM system state was cleaned and disabled; exiting instead of continuing the crash loop.");
      isShuttingDown = true;
      if (!cleanup()) {
        isShuttingDown = false;
        throw new Error("Recovery worker shutdown cleanup could not be confirmed");
      }
      process.exit(1);
    } catch (error) {
      // Keep a live recovery worker when possible; it retains ownership and
      // gives the operator a safe surface from which to retry cleanup.
      console.error(`Recovery cleanup failed: ${error.message}`);
      if (server?.exitCode != null || server?.signalCode != null) {
        recoveryInProgress = false;
      }
      isShuttingDown = false;
    }
  }

  attachServerEvents();
}
