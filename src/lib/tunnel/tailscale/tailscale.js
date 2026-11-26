import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { createRequire } from "node:module";
import { execSync, execFileSync, exec, spawn } from "child_process";
import { promisify } from "util";
import { execWithPassword } from "@/mitm/dns/dnsConfig";
import { DATA_DIR } from "@/lib/dataDir.js";
import { isObject, isString } from "../../../shared/utils/typeChecks.js";

const require = createRequire(import.meta.url);
const { resolveTrustedUnixBinary, isTrustedUnixFile } = require("../../../mitm/trustedBinaries.js");

const execAsync = promisify(exec);

const BIN_DIR = path.join(DATA_DIR, "bin");
const IS_MAC = os.platform() === "darwin";
const IS_LINUX = os.platform() === "linux";
const IS_WINDOWS = os.platform() === "win32";
const TAILSCALE_BIN = path.join(BIN_DIR, IS_WINDOWS ? "tailscale.exe" : "tailscale");

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR = path.join(DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET = path.join(TAILSCALE_DIR, "tailscaled.sock");
const SOCKET_FLAG = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];

// System daemon socket (sudo install: apt/snap/systemd) — read-only status detection
const SYSTEM_TAILSCALE_SOCKET = IS_WINDOWS ? null : "/var/run/tailscale/tailscaled.sock";
const SYSTEM_SOCKET_FLAG = SYSTEM_TAILSCALE_SOCKET ? ["--socket", SYSTEM_TAILSCALE_SOCKET] : [];

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";

// Common Unix install paths to probe synchronously (system tailscale)
const UNIX_TAILSCALE_CANDIDATES = [
"/usr/local/bin/tailscale",
"/opt/homebrew/bin/tailscale",
"/usr/sbin/tailscale", // apt package on Debian/Ubuntu
"/usr/bin/tailscale",
"/snap/bin/tailscale" // Snap package
];

// Intel and Apple Silicon Homebrew. The result can be spawned through sudo, so
// never derive it from PATH, DATA_DIR or the resolved CLI.
const MAC_TAILSCALED_CANDIDATES = ["/usr/local/bin/tailscaled", "/opt/homebrew/bin/tailscaled"];

export function resolveTailscaledBin({ isMac = IS_MAC, exists = fs.existsSync } = {}) {
  if (!isMac) return "tailscaled";
  return MAC_TAILSCALED_CANDIDATES.find((candidate) => exists(candidate)) || null;
}

// ─── Cache + background refresh (avoid blocking event loop on dead daemon) ──
const PROBE_TTL_MS = 10000;
const PROBE_TIMEOUT_MS = 1500;

const binCache = { value: undefined, fetchedAt: 0, refreshing: false };
const runningCache = { value: false, fetchedAt: 0, refreshing: false };
const loggedInCache = { value: false, fetchedAt: 0, refreshing: false };
const funnelUrlCache = { value: null, port: null, fetchedAt: 0, refreshing: false };

// Socket candidates to try, in order: this app's own tailscaled, the system
// daemon, then no --socket at all.
//
// Probing a socket that does not exist costs the FULL command timeout before
// the CLI gives up, and the app-local socket is absent on every
// system-managed Tailscale install. That made `status` + `funnel status` burn
// two timeouts on a perfectly healthy host: measured at 10.1s on production,
// where the system socket answers the same commands in 12-19ms. Because these
// are execSync, that also blocked the event loop for the whole 10s and stalled
// every other request through the gateway.
//
// Existence is cheap to check and exact for a unix socket, so skip candidates
// that cannot possibly answer. The bare [] candidate is always kept: it lets
// the CLI apply its own default, which is the right behaviour on Windows and
// on installs using a non-standard socket path.
function socketCandidates() {
  const candidates = [SOCKET_FLAG, SYSTEM_SOCKET_FLAG];
  const reachable = candidates.filter((flag) => {
    const socketPath = flag[1];
    if (!socketPath) return false;
    try {
      return fs.existsSync(socketPath);
    } catch {
      return false;
    }
  });
  return [...reachable, []];
}

function fallbackBin() {
  if (fs.existsSync(TAILSCALE_BIN)) return TAILSCALE_BIN;
  if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) return WINDOWS_TAILSCALE_BIN;
  if (!IS_WINDOWS) return UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
  return null;
}

function bgRefreshBin() {
  if (binCache.refreshing) return;
  binCache.refreshing = true;
  const cmd = IS_WINDOWS ? "where tailscale 2>nul" : "which tailscale 2>/dev/null";
  execAsync(cmd, { windowsHide: true, timeout: PROBE_TIMEOUT_MS, env: { ...process.env, PATH: EXTENDED_PATH } }).
  then(({ stdout }) => {
    const sys = stdout.trim();
    binCache.value = sys || fallbackBin();
  }).
  catch(() => {binCache.value = fallbackBin();}).
  finally(() => {
    binCache.fetchedAt = Date.now();
    binCache.refreshing = false;
  });
}

// Sync getter: returns cached value, triggers background refresh if stale
export function getTailscaleBin() {
  if (Date.now() - binCache.fetchedAt > PROBE_TTL_MS) bgRefreshBin();
  // First call: synchronously probe common install paths (no exec, no event-loop block)
  if (binCache.value === undefined) {
    if (fs.existsSync(TAILSCALE_BIN)) binCache.value = TAILSCALE_BIN;else
    if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) binCache.value = WINDOWS_TAILSCALE_BIN;else
    if (!IS_WINDOWS) {
      const found = UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p));
      binCache.value = found || null;
    } else binCache.value = null;
  }
  return binCache.value;
}

export function isTailscaleInstalled() {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args) {
  return [...SOCKET_FLAG, ...args];
}

// Async strict probe: authoritative, awaitable (never blocks event loop). Updates cache.
export async function isTailscaleLoggedInStrict() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const { stdout } = await execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 5000
    });
    const json = JSON.parse(stdout);
    // BackendState=Running + Self.Online=true → device still exists in tailnet
    const loggedIn = json.BackendState === "Running" && json.Self?.Online === true;
    loggedInCache.value = loggedIn;
    loggedInCache.fetchedAt = Date.now();
    return loggedIn;
  } catch {
    return false;
  }
}

function bgRefreshLoggedIn() {
  if (loggedInCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) {
    loggedInCache.value = false;
    loggedInCache.fetchedAt = Date.now();
    return;
  }
  loggedInCache.refreshing = true;
  // Dual-socket aware: probe custom socket first, then system socket
  probeStatusAsync(bin).
  then((json) => {
    loggedInCache.value = !!json && json.BackendState === "Running" && json.Self?.Online === true;
  }).
  catch(() => {loggedInCache.value = false;}).
  finally(() => {
    loggedInCache.fetchedAt = Date.now();
    loggedInCache.refreshing = false;
  });
}

// Probe `status --json` over custom then system socket. Resolves parsed JSON or null. Never blocks event loop.
async function probeStatusAsync(bin) {
  for (const socketArgs of socketCandidates()) {
    try {
      const { stdout } = await execAsync(`"${bin}" ${socketArgs.join(" ")} status --json`, {
        windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: PROBE_TIMEOUT_MS
      });
      return JSON.parse(stdout);
    } catch {/* try next socket */}
  }
  return null;
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleLoggedIn() {
  if (Date.now() - loggedInCache.fetchedAt > PROBE_TTL_MS) bgRefreshLoggedIn();
  return loggedInCache.value;
}

function bgRefreshRunning() {
  if (runningCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) {
    runningCache.value = false;
    runningCache.fetchedAt = Date.now();
    return;
  }
  runningCache.refreshing = true;
  execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json`, { windowsHide: true, timeout: PROBE_TIMEOUT_MS }).
  then(({ stdout }) => {
    try {
      const json = JSON.parse(stdout);
      runningCache.value = Object.keys(json.AllowFunnel || {}).length > 0;
    } catch {runningCache.value = false;}
  }).
  catch(() => {runningCache.value = false;}).
  finally(() => {
    runningCache.fetchedAt = Date.now();
    runningCache.refreshing = false;
  });
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleRunning() {
  if (Date.now() - runningCache.fetchedAt > PROBE_TTL_MS) bgRefreshRunning();
  return runningCache.value;
}

// Async strict probe for hot user-initiated paths (enable/connect flow).
// Awaitable, never blocks event loop; updates cache as a side effect.
export async function isTailscaleRunningStrict() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const { stdout } = await execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json`, {
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS
    });
    const json = JSON.parse(stdout);
    const running = Object.keys(json.AllowFunnel || {}).length > 0;
    runningCache.value = running;
    runningCache.fetchedAt = Date.now();
    return running;
  } catch {
    return false;
  }
}

// Check if a system-level tailscaled is running (uses system socket, not 9Router's custom one).
export function isSystemDaemonRunning() {
  if (IS_WINDOWS || !SYSTEM_TAILSCALE_SOCKET || !fs.existsSync(SYSTEM_TAILSCALE_SOCKET)) return false;
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = execSync(`"${bin}" ${SYSTEM_SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: PROBE_TIMEOUT_MS
    });
    return JSON.parse(out).BackendState === "Running";
  } catch {
    return false;
  }
}

function bgRefreshFunnelUrl(port) {
  if (funnelUrlCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) return;
  funnelUrlCache.refreshing = true;
  execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, { windowsHide: true, timeout: PROBE_TIMEOUT_MS }).
  then(({ stdout }) => {
    try {
      const json = JSON.parse(stdout);
      const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
      funnelUrlCache.value = dnsName ? `https://${dnsName}` : null;
    } catch {/* keep prev */}
  }).
  catch(() => {/* keep prev */}).
  finally(() => {
    funnelUrlCache.port = port;
    funnelUrlCache.fetchedAt = Date.now();
    funnelUrlCache.refreshing = false;
  });
}

// Run a tailscale subcommand synchronously, trying the app socket, then the
// system socket, then the default (no --socket) so it works whether the funnel
// is served by 9Router's own tailscaled or a system-installed one. Returns
// parsed JSON, or null if every socket fails.
function execTailscaleJsonSync(subArgs) {
  const bin = getTailscaleBin();
  if (!bin) return null;
  for (const socketArgs of socketCandidates()) {
    try {
      const out = execSync(`"${bin}" ${socketArgs.join(" ")} ${subArgs}`, {
        encoding: "utf8", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH },
        // Was 5000. A reachable daemon answers in ~12-19ms; this budget only
        // ever elapses when the socket cannot reply, and it does so on the
        // event loop, so keep it tight and consistent with the async probes.
        timeout: PROBE_TIMEOUT_MS
      });
      return JSON.parse(out);
    } catch {/* try next socket */}
  }
  return null;
}

// Pure: resolve the public funnel port (":<port>" or "") that fronts `localPort`
// from a parsed `funnel status --json`. `funnel status` returns a `Web` map
// keyed `"<host>:<funnelPort>"` whose handlers carry `Proxy:
// "http://localhost:<localPort>"`. Match the entry whose proxy target port
// equals our server port; a 443 funnel is implicit so it returns "". Falls back
// to the sole funnel port when only one exists. Exported for tests.
export function resolveFunnelPortFromJson(funnelJson, localPort) {
  const web = funnelJson?.Web;
  const target = Number.parseInt(String(localPort ?? process.env.PORT ?? ""), 10);

  if (web && isObject(web) && Number.isFinite(target)) {
    for (const key of Object.keys(web)) {
      const handlers = web[key]?.Handlers;
      if (!handlers || !isObject(handlers)) continue;
      const proxied = Object.values(handlers).some((h) => {
        const m = isString(h?.Proxy) ? h.Proxy.match(/:(\d+)(?:\/|$)/) : null;
        return m && Number.parseInt(m[1], 10) === target;
      });
      if (proxied) {
        const fp = Number.parseInt(String(key).split(":").pop(), 10);
        return Number.isFinite(fp) && fp !== 443 ? `:${fp}` : "";
      }
    }
  }

  const tcp = funnelJson?.TCP;
  if (tcp && isObject(tcp)) {
    const ports = Object.keys(tcp).filter((p) => tcp[p]?.HTTPS).map((p) => Number.parseInt(p, 10)).filter(Number.isFinite);
    if (ports.length === 1 && ports[0] !== 443) return `:${ports[0]}`;
  }
  return "";
}

// Pure: build the funnel URL from parsed `status --json` + `funnel status
// --json`. Returns null when Self.DNSName is missing. Exported for tests.
export function deriveTailscaleFunnelUrl(statusJson, funnelJson, localPort) {
  const dnsName = statusJson?.Self?.DNSName?.replace(/\.$/, "");
  if (!dnsName) return null;
  return `https://${dnsName}${resolveFunnelPortFromJson(funnelJson, localPort)}`;
}

/**
 * Actual Tailscale funnel URL for this node: `https://<Self.DNSName>[:port]`.
 * Reads `Self.DNSName` (authoritative — avoids the hostname-conflict suffix)
 * over whichever tailscaled socket answers, and appends the funnel port that
 * fronts our local server (matched from `funnel status`). Sync; returns null if
 * tailscale can't be reached at all.
 * @param {number|string} [localPort] server port (defaults to process.env.PORT)
 */
export function getActualFunnelUrl(localPort) {
  const statusJson = execTailscaleJsonSync("status --json");
  const funnelJson = execTailscaleJsonSync("funnel status --json");
  return deriveTailscaleFunnelUrl(statusJson, funnelJson, localPort);
}

/** Get funnel URL from tailscale status (cached, non-blocking) */
export function getTailscaleFunnelUrl(port) {
  if (Date.now() - funnelUrlCache.fetchedAt > PROBE_TTL_MS || funnelUrlCache.port !== port) {
    bgRefreshFunnelUrl(port);
  }
  return funnelUrlCache.value;
}

/**
 * Install tailscale.
 * - macOS + brew: brew install tailscale (no sudo needed)
 * - macOS no brew: download .pkg then sudo installer -pkg
 * - Linux: fetch install.sh, pipe to sudo -S sh via stdin
 * - Windows: download MSI via UAC-elevated PowerShell
 */
export async function installTailscale(sudoPassword, hostname, onProgress) {
  const log = onProgress || (() => {});
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return { success: true };
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);else
  await installTailscaleLinux(sudoPassword, log);

  log("Starting daemon...");
  await startDaemonWithPassword(sudoPassword);
  log("Logging in...");
  return startLogin(hostname);
}

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;

function hasBrew() {
  try {execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } });return true;} catch {return false;}
}

async function installTailscaleMac(sudoPassword, log) {
  if (hasBrew()) {
    log("Installing via Homebrew...");
    await new Promise((resolve, reject) => {
      const child = spawn("brew", ["install", "tailscale"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }
      });
      child.stdout.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.on("close", (c) => {
        if (c === 0) resolve();else
        reject(new Error(`brew install failed (code ${c})`));
      });
      child.on("error", reject);
    });
    return;
  }

  // No brew: download .pkg into a private dir, verify the Apple signature, then sudo installer
  const pkgUrl = "https://pkgs.tailscale.com/stable/tailscale-latest.pkg";
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailscale-pkg-"));
  fs.chmodSync(workDir, 0o700);
  const pkgPath = path.join(workDir, "tailscale.pkg");
  const cleanupDir = () => {try {fs.rmSync(workDir, { recursive: true, force: true });} catch {/* ignore */}};

  try {
    log("Downloading Tailscale package...");
    await downloadToFile("curl", ["-fL", "--proto", "=https", "--tlsv1.2", "--progress-bar", pkgUrl, "-o", "-"], pkgPath, (line) => log(line));

    log("Verifying package signature...");
    verifyTailscalePkgSignature(pkgPath);

    log("Installing package...");
    const sudoBin = resolveTrustedUnixBinary("sudo");
    await new Promise((resolve, reject) => {
      const child = spawn(sudoBin, ["-S", "installer", "-pkg", pkgPath, "-target", "/"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      let stderr = "";
      child.stderr.on("data", (d) => {stderr += d.toString();});
      child.stdout.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.on("close", (c) => {
        if (c === 0) resolve();else
        {
          const msg = stderr.includes("incorrect password") || stderr.includes("Sorry") ?
          "Wrong sudo password" :
          stderr || `Exit code ${c}`;
          reject(new Error(msg));
        }
      });
      child.on("error", reject);
      child.stdin.write(`${sudoPassword}\n`);
      child.stdin.end();
    });
  } finally {
    cleanupDir();
  }
}

// Pinned SHA-256 of https://tailscale.com/install.sh. The script is run as root, so it must match
// a known digest. When Tailscale publishes a new script, review it and bump this value (or set
// TAILSCALE_INSTALL_SCRIPT_SHA256 after reviewing the script yourself).
export const TAILSCALE_INSTALL_SCRIPT_SHA256 =
"4207f322e10ad26b3054abe7c99dfb54da09843c8d0a50d0a82f8eff4972a0d1";

export function verifyTailscaleInstallScript(content) {
  const expected = (process.env.TAILSCALE_INSTALL_SCRIPT_SHA256 || TAILSCALE_INSTALL_SCRIPT_SHA256).trim().toLowerCase();
  const actual = crypto.createHash("sha256").update(content).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Tailscale install script SHA-256 mismatch (got ${actual}); refusing to run it as root. ` +
      "Install Tailscale manually from https://tailscale.com/download or review the script and set TAILSCALE_INSTALL_SCRIPT_SHA256."
    );
  }
}

// `pkgutil --check-signature` output must show a signed package whose leaf certificate is the
// Tailscale Developer ID Installer identity.
export function assertTailscalePkgSignature(output) {
  const text = isString(output) ? output : "";
  const signed = /^\s*Status:\s*signed by a developer certificate issued by Apple for distribution\s*$/m.test(text);
  const signer = /^\s*1\.\s*Developer ID Installer: Tailscale Inc\. \(W5364U7YZB\)\s*$/m.test(text);
  const appleChain = /^\s*2\.\s*Developer ID Certification Authority\s*$/m.test(text) &&
    /^\s*3\.\s*Apple Root CA\s*$/m.test(text);
  if (!signed || !signer || !appleChain) {
    throw new Error("Tailscale package signature check failed (expected Developer ID Installer: Tailscale Inc.); refusing to install");
  }
}

function verifyTailscalePkgSignature(pkgPath) {
  let output;
  try {
    output = execFileSync("/usr/sbin/pkgutil", ["--check-signature", pkgPath], { encoding: "utf8", windowsHide: true });
  } catch (error) {
    throw new Error(`Tailscale package is not signed: ${error.stderr || error.message}`);
  }
  assertTailscalePkgSignature(output);
}

// Stream a download (curl writing to stdout) into a file created exclusively (O_EXCL) with mode 0600.
function downloadToFile(cmd, args, destPath, onStderrLine) {
  return new Promise((resolve, reject) => {
    let fd;
    try {
      fd = fs.openSync(destPath, "wx", 0o600);
    } catch (e) {
      return reject(e);
    }
    let writeError = null;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.on("data", (d) => {
      if (writeError) return;
      try {fs.writeSync(fd, d);} catch (e) {writeError = e;child.kill();}
    });
    child.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (line && onStderrLine) onStderrLine(line);
    });
    child.on("close", (c) => {
      try {fs.closeSync(fd);} catch {/* ignore */}
      if (writeError) return reject(new Error(`Failed to write download: ${writeError.message}`));
      if (c === 0) resolve();else
      reject(new Error("Download failed"));
    });
    child.on("error", (e) => {
      try {fs.closeSync(fd);} catch {/* ignore */}
      reject(e);
    });
  });
}

async function installTailscaleLinux(sudoPassword, log) {
  // Reject password containing newline → prevents stdin command injection
  if (!isString(sudoPassword) || sudoPassword.includes("\n")) {
    throw new Error("Invalid sudo password");
  }
  log("Downloading install script...");
  const scriptContent = await new Promise((resolve, reject) => {
    const curlChild = spawn("curl", ["-fsSL", "--proto", "=https", "--tlsv1.2", "https://tailscale.com/install.sh"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const chunks = [];
    let curlErr = "";
    curlChild.stdout.on("data", (d) => {chunks.push(d);});
    curlChild.stderr.on("data", (d) => {curlErr += d.toString();});
    curlChild.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`Failed to download install script: ${curlErr}`));
      resolve(Buffer.concat(chunks));
    });
    curlChild.on("error", reject);
  });

  // Never run an unverified script as root
  log("Verifying install script...");
  verifyTailscaleInstallScript(scriptContent);

  log("Running install script...");
  // Persist script to a private (0700) temp dir → exec by path (NOT via stdin) → sh never reads attacker-controlled stdin
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailscale-install-"));
  const cleanup = () => {try {fs.rmSync(workDir, { recursive: true, force: true });} catch {/* ignore */}};
  const tmpScript = path.join(workDir, "install.sh");
  try {
    fs.chmodSync(workDir, 0o700);
    fs.writeFileSync(tmpScript, scriptContent, { mode: 0o700, flag: "wx" });
  } catch (e) {
    cleanup();
    throw new Error(`Failed to write install script: ${e.message}`);
  }
  let sudoBin;
  try {
    sudoBin = resolveTrustedUnixBinary("sudo");
  } catch (error) {
    cleanup();
    throw new Error(`Cannot run Tailscale installer: ${error.message}`);
  }
  await new Promise((resolve, reject) => {
    const child = spawn(sudoBin, ["-S", "sh", tmpScript], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.stderr.on("data", (d) => {stderr += d.toString();});
    child.on("close", (c) => {
      cleanup();
      if (c === 0) resolve();else
      {
        const msg = stderr.includes("incorrect password") || stderr.includes("Sorry") ?
        "Wrong sudo password" :
        stderr || `Exit code ${c}`;
        reject(new Error(msg));
      }
    });
    child.on("error", (e) => {cleanup();reject(e);});
    child.stdin.write(`${sudoPassword}\n`);
    child.stdin.end();
  });
}

// PowerShell snippet: MSI must carry a Valid Authenticode signature from Tailscale Inc.
export const WINDOWS_MSI_SIGNATURE_SCRIPT =
"$s = Get-AuthenticodeSignature -LiteralPath $env:TS_MSI_PATH; " +
"if ($s.Status -ne 'Valid') { Write-Error \"Signature status: $($s.Status)\"; exit 2 }; " +
"if ($null -eq $s.SignerCertificate -or $s.SignerCertificate.Subject -notmatch '(^|, )O=Tailscale Inc\\.(,|$)') { Write-Error 'Signer is not Tailscale Inc.'; exit 3 }";

async function installTailscaleWindows(log) {
  const msiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailscale-msi-"));
  const msiPath = path.join(workDir, "tailscale-setup.msi");
  const cleanupDir = () => {try {fs.rmSync(workDir, { recursive: true, force: true });} catch {/* ignore */}};

  try {
    // Download MSI via curl.exe (built-in on Win10+) into an exclusively created file
    log("Downloading Tailscale installer...");
    let lastPct = "";
    await downloadToFile("curl.exe", ["-fL", "--proto", "=https", "--tlsv1.2", "-#", "-o", "-", msiUrl], msiPath, (text) => {
      const match = text.match(/(\d+\.\d)%/);
      if (match && match[1] !== lastPct) {
        lastPct = match[1];
        log(`Downloading... ${lastPct}%`);
      }
    });

    // Verify Authenticode signature before anything runs elevated
    log("Verifying installer signature...");
    await new Promise((resolve, reject) => {
      const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_MSI_SIGNATURE_SCRIPT], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, TS_MSI_PATH: msiPath }
      });
      let stderr = "";
      child.stderr.on("data", (d) => {stderr += d.toString();});
      child.on("close", (c) => c === 0 ? resolve() : reject(new Error(`Tailscale installer signature check failed: ${stderr.trim() || `code ${c}`}`)));
      child.on("error", reject);
    });

    // Install MSI with UAC elevation via PowerShell Start-Process -Verb RunAs
    log("Installing Tailscale (UAC prompt may appear)...");
    await new Promise((resolve, reject) => {
      const args = `'/i','${msiPath.replace(/'/g, "''")}','TS_NOLAUNCH=true','/quiet','/norestart'`;
      const child = spawn("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Start-Process msiexec -ArgumentList ${args} -Verb RunAs -Wait`],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      child.stderr.on("data", (d) => {const l = d.toString().trim();if (l) log(l);});
      child.on("close", (c) => {
        c === 0 ? resolve() : reject(new Error(`msiexec failed (code ${c})`));
      });
      child.on("error", reject);
    });
  } finally {
    cleanupDir();
  }

  // Verify tailscale.exe exists after install
  log("Verifying installation...");
  const maxWait = 10000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(WINDOWS_TAILSCALE_BIN)) {
      log("Installation complete.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Installation finished but tailscale.exe not found");
}

// Self-heal: if state dir/files were previously created by root (e.g. legacy sudo daemon),
// reclaim ownership recursively so the user-mode daemon can read/write state files.
async function ensureUserOwnedDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    const uid = process.getuid();
    const gid = process.getgid();

    // Walk dir + all entries to find any non-user-owned items
    const needsChown = (() => {
      const stack = [dir];
      while (stack.length) {
        const cur = stack.pop();
        try {
          const st = fs.statSync(cur);
          if (st.uid !== uid) return true;
          if (st.isDirectory()) {
            for (const name of fs.readdirSync(cur)) stack.push(path.join(cur, name));
          }
        } catch {/* ignore */}
      }
      return false;
    })();

    if (!needsChown) return;

    // Try direct chown first (works if already owned). Fallback to passwordless sudo.
    try {
      execSync(`chown -R ${uid}:${gid} "${dir}"`, { stdio: "ignore", timeout: 3000 });
    } catch {
      try {execSync(`sudo -n chown -R ${uid}:${gid} "${dir}"`, { stdio: "ignore", timeout: 3000 });} catch {/* ignore */}
    }
  } catch {/* ignore */}
}

/** Check if running daemon uses TUN mode (Funnel TLS requires TUN). */
function isDaemonTunMode() {
  try {
    const ps = execSync(`pgrep -af "tailscaled.*${TAILSCALE_SOCKET}"`, { encoding: "utf8", timeout: 2000 }).trim();
    if (!ps) return null;
    return !ps.includes("--tun=userspace-networking");
  } catch {return null;}
}

/** Daemon process alive (independent of funnel state) — mirrors cloudflared PID check semantic. */
export function isDaemonAlive() {
  return isDaemonTunMode() !== null;
}

/**
 * Start tailscaled.
 * - With sudoPassword and a trusted root-owned daemon: TUN mode (root)
 * - Without: userspace-networking fallback (no sudo, but Funnel TLS unstable)
 * State always lives in ~/.9router/tailscale/ via --statedir.
 */
export async function startDaemonWithPassword(sudoPassword) {
  if (IS_WINDOWS) {
    // Windows: tailscale runs as a Windows Service. Start it then poll BackendState
    // until daemon finishes init (avoids "NoState" errors when calling funnel/up too early).
    const bin = getTailscaleBin();
    console.log("[Tailscale] win: net start Tailscale");
    try {execSync("net start Tailscale", { stdio: "ignore", windowsHide: true, timeout: 10000 });}
    catch {/* may need admin, or already running */}
    if (!bin) return;
    // Poll up to ~10s for backend to leave NoState
    for (let i = 0; i < 20; i++) {
      try {
        const out = execSync(`"${bin}" status --json`, { encoding: "utf8", windowsHide: true, timeout: 2000 });
        const j = JSON.parse(out);
        if (j.BackendState && j.BackendState !== "NoState") {
          console.log(`[Tailscale] win: BackendState=${j.BackendState} after ${i * 500}ms`);
          return;
        }
      } catch {/* daemon not ready */}
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("[Tailscale] win: BackendState still NoState after poll");
    return;
  }

  const currentMode = isDaemonTunMode(); // true=TUN, false=userspace, null=not running
  // No password but a healthy TUN daemon already runs → keep TUN, never downgrade-kill it.
  const daemonCandidates = IS_MAC ? MAC_TAILSCALED_CANDIDATES : ["/usr/sbin/tailscaled", "/usr/bin/tailscaled", "/usr/local/sbin/tailscaled", "/usr/local/bin/tailscaled", "/snap/bin/tailscaled"];
  const trustedDaemon = daemonCandidates.find((candidate) => isTrustedUnixFile(candidate, { fsImpl: fs, checkParents: true }));
  const wantTun = sudoPassword ? Boolean(trustedDaemon) : currentMode === true;

  // Daemon already running in correct mode → reuse
  if (currentMode !== null && currentMode === wantTun) {
    try {
      const bin = getTailscaleBin() || "tailscale";
      execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
        stdio: "ignore", windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }, timeout: 3000
      });
      return;
    } catch {/* unresponsive, restart below */}
  }

  // Mode mismatch or unresponsive → kill all daemons on our socket
  try {execSync(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, { stdio: "ignore", timeout: 3000 });} catch {/* ignore */}
  if (sudoPassword) {
    try {await execWithPassword(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, sudoPassword);} catch {/* ignore */}
  } else {
    try {execSync(`sudo -n pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, { stdio: "ignore", timeout: 3000 });} catch {/* ignore */}
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Reclaim folder ownership (previous root daemon may have locked it)
  await ensureUserOwnedDir(TAILSCALE_DIR);

  const launchTun = Boolean(sudoPassword && trustedDaemon);
  const tailscaledBin = launchTun ? fs.realpathSync(trustedDaemon) : resolveTailscaledBin();
  if (!tailscaledBin) throw new Error("Tailscaled binary not found");
  const daemonArgs = [
  `--socket=${TAILSCALE_SOCKET}`,
  `--statedir=${TAILSCALE_DIR}`];

  if (!launchTun) daemonArgs.push("--tun=userspace-networking");

  if (launchTun) {
    // TUN mode: spawn via sudo, password via stdin. Detached so it survives parent exit.
    const sudoBin = resolveTrustedUnixBinary("sudo");
    const child = spawn(sudoBin, ["-S", tailscaledBin, ...daemonArgs], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH }
    });
    child.stdin.write(`${sudoPassword}\n`);
    child.stdin.end();
    child.unref();
  } else {
    const child = spawn(tailscaledBin, daemonArgs, {
      detached: true,
      stdio: "ignore",
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH }
    });
    child.unref();
  }

  // Wait for socket ready
  await new Promise((r) => setTimeout(r, 3000));
}

/** Best-effort: ensure daemon running (used for login flow) */
function ensureDaemon() {
  startDaemonWithPassword("").catch(() => {});
}

/** Read AuthURL from `tailscale status --json` (Win exposes it there, not stdout). */
function getAuthUrlFromStatus() {
  const bin = getTailscaleBin();
  if (!bin) return null;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8", windowsHide: true, timeout: 2000
    });
    const j = JSON.parse(out);
    if (j.AuthURL) return j.AuthURL;
    return null;
  } catch {return null;}
}

/** Build login arguments, including an optional unattended authentication key. */
export function buildTailscaleUpArgs(hostname, authKeyFile = null) {
  const args = tsArgs("up", "--accept-routes");
  if (hostname) args.push(`--hostname=${hostname}`);
  if (isString(authKeyFile) && authKeyFile) args.push(`--auth-key=file:${authKeyFile}`);
  return args;
}

/** Run `tailscale up` and capture the auth URL or unattended login status. */
export function startLogin(hostname) {
  const bin = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));

  return new Promise((resolve, reject) => {
    // Ensure daemon is running (best-effort, no sudo)
    ensureDaemon();

    // Check if already logged in
    if (isTailscaleLoggedIn()) {
      resolve({ alreadyLoggedIn: true });
      return;
    }

    let authKeyDir = null;
    try {
      const authKey = process.env.TAILSCALE_AUTHKEY?.trim();
      if (authKey) {
        authKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailscale-authkey-"));
        const authKeyPath = path.join(authKeyDir, "authkey");
        fs.writeFileSync(authKeyPath, authKey, { mode: 0o600, flag: "wx" });
        const args = buildTailscaleUpArgs(hostname, authKeyPath);
        return spawnLogin(args, bin, authKeyDir, resolve, reject);
      }
      return spawnLogin(buildTailscaleUpArgs(hostname), bin, authKeyDir, resolve, reject);
    } catch (error) {
      if (authKeyDir) { try { fs.rmSync(authKeyDir, { recursive: true, force: true }); } catch { /* ignore */ } }
      reject(error);
    }
  });
}

function spawnLogin(args, bin, authKeyDir, resolve, reject) {
    const cleanupAuthKey = () => {
      if (authKeyDir) { try { fs.rmSync(authKeyDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    };
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const parseAuthUrl = (text) => {
      const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    const finishWithUrl = (url, source) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.log(`[Tailscale] login authUrl detected (${source})`);
      child.unref();
      resolve({ authUrl: url });
    };

    // Poll status --json every 500ms — Windows exposes AuthURL only there
    const statusPoll = setInterval(() => {
      if (resolved) return;
      if (isTailscaleLoggedIn()) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(statusPoll);
        child.unref();
        resolve({ alreadyLoggedIn: true });
        return;
      }
      const url = getAuthUrlFromStatus();
      if (url) finishWithUrl(url, "status");
    }, 500);

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(statusPoll);
      child.unref();
      const url = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) resolve({ authUrl: url });else
      if (isTailscaleLoggedIn()) resolve({ alreadyLoggedIn: true });else
      reject(new Error("tailscale up timed out without auth URL"));
    }, 15000);

    const handleData = (data) => {
      output += data.toString();
      const url = parseAuthUrl(output);
      if (url) finishWithUrl(url, "stdout");
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);
    child.once("exit", cleanupAuthKey);
    child.once("close", cleanupAuthKey);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      cleanupAuthKey();
      console.error(`[Tailscale] login spawn error: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code) => {
      if (resolved) return;
      console.log(`[Tailscale] login exit code=${code}`);
      // Don't trust exit code alone — Win `tailscale up` exits 0 even when not logged in.
      // Let status poll continue until AuthURL appears or timeout.
      const url = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) {
        finishWithUrl(url, "exit");
        return;
      }
      // Only resolve alreadyLoggedIn if status confirms BackendState=Running
      if (isTailscaleLoggedIn()) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(statusPoll);
        resolve({ alreadyLoggedIn: true });
        return;
      }
      // Otherwise keep polling — daemon may publish AuthURL shortly after exit
    });
}

/** Start tailscale funnel for the given port */
export async function startFunnel(port) {
  const bin = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");

  // Reset any existing funnel
  try {execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true });} catch (e) {/* ignore */}

  return new Promise((resolve, reject) => {
    const child = spawn(bin, tsArgs("funnel", "--bg", `${port}`), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // --bg exits after setup, read actual hostname from status
      const url = getActualFunnelUrl() || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });else
      reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    // Always resolve via Self.DNSName to get the real hostname (avoids -1 suffix from conflicts)
    const parseFunnelUrl = () => getActualFunnelUrl();

    let funnelNotEnabled = false;

    const handleData = (data) => {
      output += data.toString();

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      // Wait for the enable URL to arrive in a later chunk
      if (funnelNotEnabled && !resolved) {
        const enableMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url = parseFunnelUrl();
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.log(`[Tailscale] funnel exit code=${code} output="${output.trim().slice(0, 200)}"`);
      const url = parseFunnelUrl() || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });else
      reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Provision TLS cert for funnel domain (required before Funnel serves HTTPS). Best-effort. */
export async function provisionCert(hostname) {
  const bin = getTailscaleBin();
  if (!bin || !hostname) return;
  const certsDir = path.join(TAILSCALE_DIR, "certs");
  fs.mkdirSync(certsDir, { recursive: true });
  const certFile = path.join(certsDir, `${hostname}.crt`);
  const keyFile = path.join(certsDir, `${hostname}.key`);
  try {
    await execAsync(
      `"${bin}" ${SOCKET_FLAG.join(" ")} cert --cert-file "${certFile}" --key-file "${keyFile}" "${hostname}"`,
      { windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: 30000 }
    );
    console.log(`[Tailscale] cert provisioned for ${hostname}`);
  } catch (e) {
    console.warn(`[Tailscale] cert provision failed (non-fatal): ${e.message}`);
  }
}

/** Stop tailscale funnel */
export function stopFunnel() {
  const bin = getTailscaleBin();
  if (!bin) return;
  try {execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true });} catch (e) {/* ignore */}
}

/** Kill tailscaled daemon (runs as root, needs sudo) */
export async function stopDaemon(sudoPassword) {
  // Try non-sudo first
  try {execSync("pkill -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 3000 });} catch {/* ignore */}

  // Check if still alive
  try {execSync("pgrep -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 2000 });} catch {return;} // Dead, done

  // Kill with sudo password
  if (!IS_WINDOWS) {
    try {await execWithPassword("pkill -x tailscaled", sudoPassword || "");} catch {/* ignore */}
  }

  // Cleanup socket
  try {if (fs.existsSync(TAILSCALE_SOCKET)) fs.unlinkSync(TAILSCALE_SOCKET);} catch {/* ignore */}
}
