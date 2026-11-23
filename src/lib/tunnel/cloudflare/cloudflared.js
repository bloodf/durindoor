import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import { createHash } from "crypto";
import { execSync, spawn } from "child_process";
import { savePid, loadPid, clearPid } from "./pid.js";
import { DATA_DIR } from "@/lib/dataDir.js";
import { isFunction, isUndefined } from "@/shared/utils/typeChecks.js";

const BIN_DIR = path.join(DATA_DIR, "bin");
const BINARY_NAME = "cloudflared";
const IS_WINDOWS = os.platform() === "win32";
const BIN_NAME = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const VERSION_MARKER_PATH = path.join(BIN_DIR, ".cloudflared-version");
const POWERSHELL_HIDDEN_COMMAND = "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command";
const DEFAULT_QUICK_TUNNEL_PROTOCOL = "http2";
const QUICK_TUNNEL_PROTOCOLS = new Set(["http2", "quic", "auto"]);

/** Pinned cloudflared release (SHA-256 digests from the GitHub release notes). */
export const CLOUDFLARED_VERSION = "2026.11.1";

const GITHUB_BASE_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

/**
 * Official SHA-256 digests for cloudflared ${CLOUDFLARED_VERSION} assets
 * (`gh release view 2026.11.1 -R cloudflare/cloudflared`).
 */
export const CLOUDFLARED_ASSET_SHA256 = {
  "cloudflared-darwin-amd64.tgz": "52686df40889be19803c368470bd46d5228737462f10a40380bedb6af8ed49a2",
  "cloudflared-darwin-arm64.tgz": "1cd7041838e5b0943378763ca86ddc0af896d1727875f36b29f5cc35eb2c4df7",
  "cloudflared-windows-amd64.exe": "341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35",
  "cloudflared-windows-386.exe": "060868e138e638237e33329315c3e374e0156a2fb18879e571dbc0d506060df3",
  "cloudflared-linux-amd64": "97bb3b02d23a5980fc9c15a1a270e692da1923f103f920d5b16d4931d5ab55e7",
  "cloudflared-linux-arm64": "b155cec3e48e489cfb8e5c602769fb8c771083018d8881d68b4d18a791567c5a",
};

const PLATFORM_MAPPINGS = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz"
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-386.exe"
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64"
  }
};

// Fallback order: prefer smallest/most-compatible binary per platform
const PLATFORM_FALLBACK = {
  darwin: "cloudflared-darwin-amd64.tgz",
  win32: "cloudflared-windows-386.exe",
  linux: "cloudflared-linux-amd64"
};

/** Env keys forwarded into cloudflared (never the full process.env). */
const CLOUDFLARED_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
];

/**
 * Build a minimal environment for cloudflared child processes.
 * @param {Record<string, string>} [overrides]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildCloudflaredEnv(overrides = {}) {
  const env = {};
  for (const key of CLOUDFLARED_ENV_KEYS) {
    if (!isUndefined(process.env[key])) env[key] = process.env[key];
  }
  return Object.assign(env, overrides);
}

function resolveAssetName() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMapping = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return platformMapping[arch] || PLATFORM_FALLBACK[platform];
}

function getDownloadUrl() {
  const binaryName = resolveAssetName();
  return { url: `${GITHUB_BASE_URL}/${binaryName}`, assetName: binaryName };
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function unlinkQuiet(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}

/**
 * Verify a downloaded cloudflared asset against the pinned SHA-256.
 * Deletes the file and throws on mismatch or missing digest.
 * @param {string} filePath
 * @param {string} assetName
 */
export function verifyCloudflaredAssetDigest(filePath, assetName) {
  const expected = CLOUDFLARED_ASSET_SHA256[assetName];
  if (!expected) {
    unlinkQuiet(filePath);
    throw new Error(`No pinned SHA-256 for cloudflared asset ${assetName}`);
  }
  const actual = sha256File(filePath);
  if (actual !== expected) {
    unlinkQuiet(filePath);
    throw new Error(`cloudflared SHA-256 mismatch for ${assetName}`);
  }
}

function writeVersionMarker() {
  if (!isFunction(fs.writeFileSync)) return;
  try {
    fs.writeFileSync(VERSION_MARKER_PATH, `${CLOUDFLARED_VERSION}\n`, "utf8");
  } catch { /* best effort */ }
}

function installedVersionMatches() {
  // Incomplete fs mocks (unit tests) may omit readFileSync; fall back to magic checks only.
  if (!isFunction(fs.readFileSync)) return true;
  try {
    if (!fs.existsSync(VERSION_MARKER_PATH)) return false;
    return fs.readFileSync(VERSION_MARKER_PATH, "utf8").trim() === CLOUDFLARED_VERSION;
  } catch {
    return false;
  }
}

// Download state — shared so status API can read it
const dlState = { downloading: false, progress: 0 };

export function getDownloadStatus() {
  return { downloading: dlState.downloading, progress: dlState.progress };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
      let receivedBytes = 0;
      dlState.downloading = true;
      dlState.progress = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0) dlState.progress = Math.round((receivedBytes / totalBytes) * 100);
      });

      response.pipe(file);

      file.on("finish", () => {
        dlState.downloading = false;
        dlState.progress = 100;
        file.close(() => resolve(dest));
      });

      file.on("error", (err) => {
        dlState.downloading = false;
        dlState.progress = 0;
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on("error", (err) => {
      dlState.downloading = false;
      dlState.progress = 0;
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

const MIN_BINARY_SIZE = 1024 * 1024; // 1MB - cloudflared is ~30MB+

// Validate binary is executable on current platform and not truncated
function isValidBinary(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MIN_BINARY_SIZE) return false;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (IS_WINDOWS) return magic.startsWith("4d5a"); // PE (MZ)
    if (os.platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    return magic.startsWith("7f454c46"); // ELF (Linux)
  } catch {
    return false;
  }
}

let downloadPromise = null;

export async function ensureCloudflared() {
  if (downloadPromise) return downloadPromise;
  downloadPromise = _ensureCloudflared().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

async function _ensureCloudflared() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // Clean up incomplete downloads from previous runs
  const tmpPath = `${BIN_PATH}.tmp`;
  if (fs.existsSync(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (fs.existsSync(BIN_PATH)) {
    if (!isValidBinary(BIN_PATH) || !installedVersionMatches()) {
      console.log("[cloudflared] Invalid or unpinned binary detected, re-downloading...");
      unlinkQuiet(BIN_PATH);
      unlinkQuiet(VERSION_MARKER_PATH);
    } else {
      if (!IS_WINDOWS) fs.chmodSync(BIN_PATH, "755");
      return BIN_PATH;
    }
  }

  const { url, assetName } = getDownloadUrl();
  const isArchive = assetName.endsWith(".tgz");
  const downloadDest = isArchive ? path.join(BIN_DIR, "cloudflared.tgz.tmp") : tmpPath;

  await downloadFile(url, downloadDest);

  try {
    verifyCloudflaredAssetDigest(downloadDest, assetName);
  } catch (err) {
    unlinkQuiet(downloadDest);
    throw err;
  }

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: "pipe", windowsHide: true });
    unlinkQuiet(downloadDest);
  } else {
    fs.renameSync(downloadDest, BIN_PATH);
  }

  if (!isValidBinary(BIN_PATH)) {
    unlinkQuiet(BIN_PATH);
    unlinkQuiet(VERSION_MARKER_PATH);
    throw new Error("cloudflared binary failed post-extract validation");
  }

  writeVersionMarker();

  if (!IS_WINDOWS) {
    fs.chmodSync(BIN_PATH, "755");
  }

  return BIN_PATH;
}

let cloudflaredProcess = null;
let unexpectedExitHandler = null;
let intentionalKill = false; // suppress unexpected-exit callback during deliberate kill

/** Register a callback to be called when cloudflared exits unexpectedly after connecting */
export function setUnexpectedExitHandler(handler) {
  unexpectedExitHandler = handler;
}

export async function spawnCloudflared(tunnelToken) {
  const binaryPath = await ensureCloudflared();

  const child = spawn(binaryPath, ["tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", tunnelToken], {
    detached: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    env: buildCloudflaredEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  });

  cloudflaredProcess = child;
  savePid(child.pid);

  return new Promise((resolve, reject) => {
    let connectionCount = 0;
    let resolved = false;
    const timeout = setTimeout(() => {
      resolved = true;
      resolve(child);
    }, 90000);

    const handleLog = (data) => {
      const msg = data.toString();
      // Count exact occurrences in this chunk (each chunk may contain multiple lines)
      const matches = msg.match(/Registered tunnel connection/g);
      if (matches) {
        connectionCount += matches.length;
        if (connectionCount >= 4 && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    };

    child.stdout.on("data", handleLog);
    child.stderr.on("data", handleLog);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on("exit", (code, signal) => {
      cloudflaredProcess = null;
      clearPid();
      const wasConnected = resolved; // true = already connected successfully
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Collect stderr output for better error diagnosis
        let stderrOutput = "";
        if (child.stderr && !child.stderr.destroyed) {
          // Try to read any buffered stderr (may not have all output but helps with common errors)
          stderrOutput = " Check cloudflared logs for details.";
        }
        if (code === 1) {
          // Common exit code 1 issues: invalid token, auth failure, network issues
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput} Ensure your tunnel token is valid and network is reachable.`));
        } else if (code === 2) {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput} Check if required arguments are correct.`));
        } else {
          reject(new Error(`cloudflared exited with code ${code}${stderrOutput}`));
        }
        return;
      }
      // Watchdog (initializeApp) handles recovery — no auto-reconnect here
      if (intentionalKill) { intentionalKill = false; return; }
      if (wasConnected && unexpectedExitHandler) unexpectedExitHandler();
    });
  });
}

/**
 * Spawn cloudflared quick tunnel (no account needed)
 * Returns the generated trycloudflare.com URL
 */
export async function spawnQuickTunnel(localPort, onUrlUpdate) {
  const binaryPath = await ensureCloudflared();

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-quick-"));
  const configPath = path.join(configDir, "config.yml");
  // Avoid using default ~/.cloudflared/config.yml, which can conflict with quick tunnel behavior.
  fs.writeFileSync(configPath, "# quick-tunnel config placeholder\n", "utf8");

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  };

  const requestedProtocol = String(process.env.TUNNEL_TRANSPORT_PROTOCOL || process.env.CLOUDFLARED_PROTOCOL || DEFAULT_QUICK_TUNNEL_PROTOCOL).trim().toLowerCase();
  const tunnelProtocol = QUICK_TUNNEL_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : DEFAULT_QUICK_TUNNEL_PROTOCOL;
  const child = spawn(binaryPath, ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--config", configPath, "--no-autoupdate", "--retries", "99"], {
    detached: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    env: buildCloudflaredEnv({
      TUNNEL_TRANSPORT_PROTOCOL: tunnelProtocol,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  cloudflaredProcess = child;
  savePid(child.pid);

  return new Promise((resolve, reject) => {
    let resolved = false;
    // Keep a small tail of raw cloudflared logs to surface real failure causes
    let logTail = "";

    function getQuickTunnelUrlFromLog(message) {
      // cloudflared logs may contain "api.trycloudflare.com" as well,
      // but that is NOT the quick-tunnel endpoint we need.
      const regex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;
      const candidates = [];

      for (const match of message.matchAll(regex)) {
        const host = match[1];
        if (host === "api") continue;
        candidates.push(`https://${host}.trycloudflare.com`);
      }

      if (!candidates.length) return null;
      return candidates[candidates.length - 1];
    }

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error(`Quick tunnel timed out. Last log: ${logTail.slice(-800) || "(empty)"}`));
    }, 90000);

    let lastUrl = null;

    const handleLog = (data) => {
      const msg = data.toString();
      logTail = (logTail + msg).slice(-4000);
      const tunnelUrl = getQuickTunnelUrlFromLog(msg);
      if (!tunnelUrl) return;

      if (!resolved) {
        // First URL — resolve the promise, do NOT call onUrlUpdate (caller handles initial register)
        resolved = true;
        lastUrl = tunnelUrl;
        clearTimeout(timeout);
        cleanup();
        console.log(`[Tunnel] cloudflared URL: ${tunnelUrl}`);
        resolve({ child, tunnelUrl });
        return;
      }

      // URL changed after initial connect — notify caller to re-register
      if (tunnelUrl !== lastUrl) {
        console.log(`[Tunnel] cloudflared URL changed: ${tunnelUrl}`);
        lastUrl = tunnelUrl;
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    child.stdout.on("data", handleLog);
    child.stderr.on("data", handleLog);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    child.on("exit", (code, signal) => {
      cloudflaredProcess = null;
      clearPid();
      // Deliberate kill (restart/disable) — exit silently, no error noise
      if (intentionalKill) {
        intentionalKill = false;
        clearTimeout(timeout);
        cleanup();
        if (!resolved) { resolved = true; reject(new Error("cloudflared killed")); }
        return;
      }
      console.log(`[Tunnel] cloudflared exit code=${code} signal=${signal}`);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        const tail = logTail.slice(-600).trim() || "(empty)";
        if (code === 1) {
          reject(new Error(`cloudflared quick tunnel exited (code 1). Common causes: (1) outbound port 7844 (TCP/UDP) blocked, (2) TryCloudflare service issue, (3) cannot reach 127.0.0.1:${localPort}, (4) protocol (http2/quic) blocked by network. Last log: ${tail}`));
        } else if (code === 2) {
          reject(new Error(`cloudflared exited (code 2). Bad arguments. Last log: ${tail}`));
        } else {
          reject(new Error(`cloudflared exited (code ${code}). Last log: ${tail}`));
        }
        return;
      }
      if (unexpectedExitHandler) unexpectedExitHandler();
      cleanup();
    });
  });
}

// Kill cloudflared processes whose command line targets the given port (any host).
// Boundary check ensures :20128 doesn't match :201280 or :202128.
function killCloudflaredByPort(port) {
  if (!port) return;
  try {
    if (IS_WINDOWS) {
      const psCmd = `Get-CimInstance Win32_Process -Filter \\"Name='cloudflared.exe'\\" | Where-Object { $_.CommandLine -match ':${port}(\\D|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      execSync(`${POWERSHELL_HIDDEN_COMMAND} "${psCmd}"`, { stdio: "ignore", windowsHide: true });
    } else {
      execSync(`pkill -f "cloudflared.*:${port}([^0-9]|$)" 2>/dev/null || true`, { stdio: "ignore", windowsHide: true });
    }
  } catch (e) { /* ignore */ }
}

export function killCloudflared(localPort) {
  intentionalKill = true;
  if (cloudflaredProcess && isCloudflaredProcess(cloudflaredProcess.pid)) {
    try {
      cloudflaredProcess.kill();
    } catch (e) { /* ignore */ }
    cloudflaredProcess = null;
  }

  const pid = loadPid();
  if (pid && isCloudflaredProcess(pid)) {
    try {
      process.kill(pid);
    } catch (e) { /* ignore */ }
  }
  clearPid();

  killCloudflaredByPort(localPort);
}

export function isCloudflaredRunning() {
  const pid = loadPid();
  if (!pid) return false;
  if (isCloudflaredProcess(pid)) return true;
  clearPid();
  return false;
}

function isCloudflaredProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    let command;
    if (os.platform() === "linux") {
      const executable = fs.realpathSync(`/proc/${pid}/exe`);
      command = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      if (path.basename(executable).toLowerCase() !== BINARY_NAME) return false;
    } else if (IS_WINDOWS) {
      const output = execSync(`powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine"`, { encoding: "utf8", windowsHide: true });
      command = [output.trim()];
    } else {
      const output = execSync(`ps -p ${pid} -o args=`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 });
      command = [output];
    }
    const text = command.join(" ").toLowerCase();
    return text.includes(BINARY_NAME) && /(?:^|\s)tunnel(?:\s|$)/.test(text) && /(?:^|\s)--url(?:\s|$)/.test(text);
  } catch {
    return false;
  }
}
