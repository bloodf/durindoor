const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { log, err } = require("../logger");
const { TOOL_HOSTS } = require("../../shared/constants/mitmToolHosts.js");
const { runElevatedPowerShell, quotePs } = require("../winElevated.js");
const {
  FIXED_UNIX_PATH,
  WINDOWS_SYSTEM_ROOT,
  resolveTrustedUnixBinary,
  resolveWindowsSystemBinary,
} = require("../trustedBinaries.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.win32.join(WINDOWS_SYSTEM_ROOT, "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";
const OWNED_HOSTS_TAG = "durindoor-mitm";

function quoteSh(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/** True when `sudo` exists (e.g. missing on minimal Docker images like Alpine). */
function isSudoAvailable() {
  if (IS_WIN) return false;
  return Boolean(resolveTrustedUnixBinary("sudo", { required: false }));
}

function canRunSudoWithoutPassword() {
  if (IS_WIN || !isSudoAvailable()) return true;
  try {
    execFileSync(resolveTrustedUnixBinary("sudo"), ["-n", "true"], {
      stdio: "ignore",
      windowsHide: true,
      env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
    });
    return true;
  } catch {
    return false;
  }
}

function isSudoPasswordRequired() {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only).
 * Without sudo in PATH (containers), runs via sh — same user, no elevation.
 */
function execWithPassword(command, password, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const sudoBin = resolveTrustedUnixBinary("sudo", { required: false });
    const shellBin = resolveTrustedUnixBinary("sh");
    const useSudo = Boolean(sudoBin);
    const trustedCommand = `PATH=${FIXED_UNIX_PATH}; export PATH; ${command}`;
    const childOptions = {
      stdio: useSudo ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: !IS_WIN,
      env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
    };
    const child = useSudo
      ? spawn(sudoBin, ["-H", "-S", shellBin, "-c", trustedCommand], childOptions)
      : spawn(shellBin, ["-c", trustedCommand], childOptions);

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceTimer = null;
    let abandonTimer = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(abandonTimer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch {
        try { child.kill("SIGTERM"); } catch { /* the child may already have exited */ }
      }
      forceTimer = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {
          try { child.kill("SIGKILL"); } catch { /* the child may already have exited */ }
        }
      }, 500);
      abandonTimer = setTimeout(() => {
        const error = new Error(`Privileged command timed out after ${timeoutMs}ms and process-tree termination was not confirmed`);
        error.code = "PRIVILEGED_TERMINATION_UNCONFIRMED";
        finish(error);
      }, 5000);
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (error) => finish(error));

    child.on("close", (code) => {
      if (timedOut) {
        finish(new Error(`Privileged command timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr || `Exit code ${code}`));
    });

    if (useSudo) {
      child.stdin.write(`${password}\n`);
      child.stdin.end();
    }
  });
}

/**
 * Build a complete elevated Windows hosts-file mutation. The unelevated parent
 * only reads the file for status; every write and DNS flush runs in the narrow
 * UAC child.
 */
function buildWindowsHostsMutationScript({
  action,
  hosts = [],
  tag = null,
  ownedEntries = null,
  hostsFile = HOSTS_FILE,
  expectedSha256,
}) {
  if (!["add", "remove", "adopt-legacy", "remove-legacy"].includes(action)) throw new Error(`Unsupported hosts action: ${action}`);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "")) throw new Error("A valid hosts snapshot digest is required");
  const entries = ownedEntries || hosts.map((host) => ({ host, tag }));
  if (entries.some((entry) => !entry.tag || !/^[a-z0-9_-]+$/i.test(entry.tag))) {
    throw new Error("A safe DurinDoor hosts ownership tag is required");
  }
  const entryLiterals = entries
    .map((entry) => `@{ Host = ${quotePs(entry.host)}; Tag = ${quotePs(entry.tag)} }`)
    .join(", ");
  const mutation = action === "add"
    ? String.raw`
      foreach ($entry in $entries) {
        $foreign = @($lines | Where-Object {
          (Test-ExactHostLine $_ $entry.Host) -and -not (Test-OwnedHostLine $_ $entry.Host $entry.Tag)
        })
        if ($foreign.Count -gt 0) { throw "Foreign hosts mapping exists for $($entry.Host)" }
        if (-not ($lines | Where-Object { Test-OwnedHostLine $_ $entry.Host $entry.Tag })) {
          $lines += "127.0.0.1 $($entry.Host) # ${OWNED_HOSTS_TAG}:$($entry.Tag)"
        }
      }
    `
    : action === "remove" ? String.raw`
      $lines = @($lines | Where-Object {
        $line = $_
        -not ($entries | Where-Object { Test-OwnedHostLine $line $_.Host $_.Tag })
      })
    ` : action === "adopt-legacy" ? String.raw`
      $lines = @($lines | ForEach-Object {
        $line = $_
        $entry = $entries | Where-Object { Test-LegacyHostLine $line $_.Host } | Select-Object -First 1
        if ($null -ne $entry) { "127.0.0.1 $($entry.Host) # ${OWNED_HOSTS_TAG}:$($entry.Tag)" } else { $line }
      })
    ` : String.raw`
      $lines = @($lines | Where-Object {
        $line = $_
        -not ($entries | Where-Object { Test-LegacyHostLine $line $_.Host })
      })
    `;

  const ipconfigPath = resolveWindowsSystemBinary("ipconfig.exe", { verify: IS_WIN });
  return String.raw`
    $ErrorActionPreference = 'Stop'
    $path = ${quotePs(hostsFile)}
    $expectedSha256 = ${quotePs(expectedSha256)}
    $entries = @(${entryLiterals})
    function Get-FileSha256([string] $filePath) {
      $algorithm = [System.Security.Cryptography.SHA256]::Create()
      try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash([System.IO.File]::ReadAllBytes($filePath)))).Replace('-', '').ToLowerInvariant()
      } finally { $algorithm.Dispose() }
    }
    function Test-ExactHostLine([string] $line, [string] $hostName) {
      $withoutComment = ($line -split '#', 2)[0].Trim()
      if (-not $withoutComment) { return $false }
      $fields = @($withoutComment -split '\s+' | Where-Object { $_ })
      if ($fields.Count -lt 2) { return $false }
      return @($fields[1..($fields.Count - 1)]) -contains $hostName
    }
    function Test-OwnedHostLine([string] $line, [string] $hostName, [string] $tag) {
      $parts = $line -split '#', 2
      if ($parts.Count -ne 2 -or $parts[1].Trim() -ne "${OWNED_HOSTS_TAG}:$tag") { return $false }
      $fields = @($parts[0].Trim() -split '\s+' | Where-Object { $_ })
      return $fields.Count -eq 2 -and $fields[0] -eq '127.0.0.1' -and $fields[1] -eq $hostName
    }
    function Test-LegacyHostLine([string] $line, [string] $hostName) {
      if ($line -match '#') { return $false }
      $fields = @($line.Trim() -split '\s+' | Where-Object { $_ })
      return $fields.Count -eq 2 -and $fields[0] -eq '127.0.0.1' -and $fields[1] -eq $hostName
    }
    $sourceBytes = [System.IO.File]::ReadAllBytes($path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
      $sourceSha256 = ([System.BitConverter]::ToString($algorithm.ComputeHash($sourceBytes))).Replace('-', '').ToLowerInvariant()
    } finally { $algorithm.Dispose() }
    if ($sourceSha256 -ne $expectedSha256) { throw 'Hosts file changed before mutation' }
    $content = [System.Text.Encoding]::UTF8.GetString($sourceBytes)
    $lines = @($content -split '\r?\n')
    ${mutation}
    $eol = [Environment]::NewLine
    $next = (($lines -join $eol).TrimEnd()) + $eol
    $committedBackup = $null
    if ($next -ne $content) {
      $suffix = [Guid]::NewGuid().ToString('N')
      $temp = "$path.durindoor.$suffix.tmp"
      $backup = "$path.durindoor.$suffix.bak"
      $published = $false
      try {
        [System.IO.File]::WriteAllText($temp, $next, [System.Text.UTF8Encoding]::new($false))
        $tempStream = [System.IO.File]::Open(
          $temp,
          [System.IO.FileMode]::Open,
          [System.IO.FileAccess]::ReadWrite,
          [System.IO.FileShare]::Read
        )
        try { $tempStream.Flush($true) } finally { $tempStream.Dispose() }
        if ([System.IO.File]::ReadAllText($temp) -ne $next) {
          throw 'DurinDoor hosts temp-file verification failed'
        }
        if ((Get-FileSha256 $path) -ne $expectedSha256) {
          throw 'Hosts file changed during mutation'
        }
        [System.IO.File]::Replace($temp, $path, $backup, $true)
        $published = $true
        if ([System.IO.File]::ReadAllText($path) -ne $next) {
          [System.IO.File]::Replace($backup, $path, $null, $true)
          $published = $false
          throw 'DurinDoor hosts publication verification failed; original restored'
        }
        $published = $false
      } finally {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        if ($published -and (Test-Path -LiteralPath $backup)) {
          [System.IO.File]::Replace($backup, $path, $null, $true)
          $published = $false
        }
      }
      $committedBackup = $backup
    }
    try {
      & ${quotePs(ipconfigPath)} /flushdns | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "ipconfig /flushdns failed with exit $LASTEXITCODE" }
    } catch {
      if ($null -ne $committedBackup -and (Test-Path -LiteralPath $committedBackup)) {
        [System.IO.File]::Replace($committedBackup, $path, $null, $true)
        $committedBackup = $null
      }
      throw
    }
    if ($null -ne $committedBackup) {
      Remove-Item -LiteralPath $committedBackup -Force -ErrorAction Stop
    }
  `;
}

/**
 * Trim trailing blank lines/whitespace, ensure file ends with exactly one newline.
 */
function normalizeHostsContent(content) {
  const eol = IS_WIN ? "\r\n" : "\n";
  return content.replace(/[\r\n\s]+$/g, "") + eol;
}

function lineHasExactHost(line, host) {
  const withoutComment = String(line || "").split("#", 1)[0].trim();
  if (!withoutComment) return false;
  const fields = withoutComment.split(/\s+/).filter(Boolean);
  return fields.length >= 2 && fields.slice(1).includes(host);
}

function lineHasOwnedHost(line, host, tag = null) {
  const parts = String(line || "").split("#", 2);
  if (parts.length !== 2) return false;
  const comment = parts[1].trim();
  if (tag ? comment !== `${OWNED_HOSTS_TAG}:${tag}` : !comment.startsWith(`${OWNED_HOSTS_TAG}:`)) return false;
  const fields = parts[0].trim().split(/\s+/).filter(Boolean);
  return fields.length === 2 && fields[0] === "127.0.0.1" && fields[1] === host;
}

function lineHasLegacyOwnedHost(line, host) {
  const value = String(line || "");
  if (value.includes("#")) return false;
  const fields = value.trim().split(/\s+/).filter(Boolean);
  return fields.length === 2 && fields[0] === "127.0.0.1" && fields[1] === host;
}

function readHostsSnapshot(hostsFile = HOSTS_FILE) {
  const pathStat = fs.lstatSync(hostsFile);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new Error(`Unsafe hosts file path: ${hostsFile}`);
  }
  const fd = fs.openSync(hostsFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const fdStat = fs.fstatSync(fd);
    if (!fdStat.isFile()
      || String(fdStat.dev) !== String(pathStat.dev)
      || String(fdStat.ino) !== String(pathStat.ino)) {
      throw new Error(`Hosts file changed while opening: ${hostsFile}`);
    }
    const bytes = fs.readFileSync(fd);
    return { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}

function buildUnixHostsMutationCommand({ currentSha256, nextBytes, hostsFile = HOSTS_FILE, isMac = IS_MAC }) {
  if (!/^[a-f0-9]{64}$/.test(currentSha256)) throw new Error("Invalid hosts snapshot digest");
  const nextBase64 = Buffer.from(nextBytes).toString("base64");
  const nextSha256 = crypto.createHash("sha256").update(nextBytes).digest("hex");
  const hash = isMac
    ? `shasum -a 256 -- "$path" | awk '{print $1}'`
    : `sha256sum -- "$path" | awk '{print $1}'`;
  const decodeFlag = isMac ? "-D" : "-d";
  const preserveCopy = isMac ? "cp -p" : "cp --preserve=all";
  return `
    set -eu
    umask 077
    path=${quoteSh(hostsFile)}
    [ -f "$path" ] && [ ! -L "$path" ] || { echo 'Unsafe hosts file path' >&2; exit 72; }
    current_hash=$(${hash})
    [ "$current_hash" = ${quoteSh(currentSha256)} ] || { echo 'Hosts file changed before mutation' >&2; exit 73; }
    dir=\${path%/*}
    temp=$(mktemp "$dir/.durindoor-hosts.XXXXXX")
    backup=$(mktemp "$dir/.durindoor-hosts-backup.XXXXXX")
    published=0
    cleanup() {
      if [ "$published" -eq 1 ] && [ -f "$backup" ]; then mv -f -- "$backup" "$path" || true; fi
      rm -f -- "$temp" "$backup"
    }
    trap cleanup EXIT HUP INT TERM
    ${preserveCopy} -- "$path" "$temp"
    ${preserveCopy} -- "$path" "$backup"
    printf '%s' ${quoteSh(nextBase64)} | base64 ${decodeFlag} > "$temp"
    sync
    [ "$(${isMac ? `shasum -a 256 -- "$temp" | awk '{print $1}'` : `sha256sum -- "$temp" | awk '{print $1}'`})" = ${quoteSh(nextSha256)} ] || { echo 'Hosts temp verification failed' >&2; exit 74; }
    [ "$(${hash})" = ${quoteSh(currentSha256)} ] || { echo 'Hosts file changed during mutation' >&2; exit 73; }
    mv -f -- "$temp" "$path"
    published=1
    sync
    [ "$(${hash})" = ${quoteSh(nextSha256)} ] || { echo 'Hosts publication verification failed' >&2; exit 75; }
    published=0
    rm -f -- "$backup"
  `;
}

async function mutateUnixHosts(
  nextContent,
  sudoPassword,
  snapshot = readHostsSnapshot(),
  execute = execWithPassword,
) {
  const nextBytes = Buffer.from(nextContent, "utf8");
  if (snapshot.bytes.equals(nextBytes)) return false;
  await execute(buildUnixHostsMutationCommand({
    currentSha256: snapshot.sha256,
    nextBytes,
  }), sudoPassword);
  return true;
}

async function commitUnixHostsAndFlush(
  nextContent,
  sudoPassword,
  snapshot,
  { mutate = mutateUnixHosts, flush = flushDNS } = {},
) {
  const changed = await mutate(nextContent, sudoPassword, snapshot);
  if (!changed) return false;
  try {
    await flush(sudoPassword);
  } catch (error) {
    // Roll back only if the hosts file still equals the content just committed.
    // mutateUnixHosts' digest checks preserve any concurrent administrator edit.
    const committedBytes = Buffer.from(nextContent, "utf8");
    const committedSnapshot = {
      bytes: committedBytes,
      sha256: crypto.createHash("sha256").update(committedBytes).digest("hex"),
    };
    try {
      await mutate(snapshot.bytes.toString("utf8"), sudoPassword, committedSnapshot);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
  return true;
}

async function reconcileLegacyDNSEntries({ action, tool = null }, sudoPassword) {
  if (action !== "adopt-legacy" && action !== "remove-legacy") throw new Error("Invalid legacy DNS reconciliation action");
  const selected = tool ? { [tool]: TOOL_HOSTS[tool] } : TOOL_HOSTS;
  if (tool && !selected[tool]) throw new Error(`Unknown tool: ${tool}`);
  const ownedEntries = Object.entries(selected).flatMap(([tag, hosts]) =>
    hosts.map((host) => ({ host, tag }))
  );
  const snapshot = readHostsSnapshot();
  const current = snapshot.bytes.toString("utf8");
  const hasLegacy = ownedEntries.some(({ host }) => current.split(/\r?\n/).some((line) => lineHasLegacyOwnedHost(line, host)));
  if (!hasLegacy) return false;
  if (IS_WIN) {
    await runElevatedPowerShell(buildWindowsHostsMutationScript({
      action,
      ownedEntries,
      expectedSha256: snapshot.sha256,
    }));
  } else {
    const nextLines = current.split(/\r?\n/).flatMap((line) => {
      const entry = ownedEntries.find(({ host }) => lineHasLegacyOwnedHost(line, host));
      if (!entry) return [line];
      return action === "adopt-legacy"
        ? [`127.0.0.1 ${entry.host} # ${OWNED_HOSTS_TAG}:${entry.tag}`]
        : [];
    });
    await commitUnixHostsAndFlush(normalizeHostsContent(nextLines.join("\n")), sudoPassword, snapshot);
  }
  return true;
}

function adoptLegacyDNSEntries(tool, sudoPassword) {
  return reconcileLegacyDNSEntries({ action: "adopt-legacy", tool }, sudoPassword);
}

function removeLegacyDNSEntries(sudoPassword) {
  return reconcileLegacyDNSEntries({ action: "remove-legacy" }, sudoPassword);
}

/**
 * Flush DNS cache (macOS/Linux)
 */
async function flushDNS(sudoPassword) {
  if (IS_WIN) return; // Windows flushes inline via ipconfig
  if (IS_MAC) {
    await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
  } else {
    await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
  }
}

/**
 * Check if DNS entry exists for a specific host
 */
function checkDNSEntry(host = null, tag = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    if (host) return hostsContent.split(/\r?\n/).some((line) => lineHasOwnedHost(line, host, tag));
    // Legacy: check all antigravity hosts (backward compat)
    return TOOL_HOSTS.antigravity.every(h => hostsContent.split(/\r?\n/).some((line) => lineHasOwnedHost(line, h, "antigravity")));
  } catch {
    return false;
  }
}

/**
 * Check DNS status per tool — returns { [tool]: boolean }
 */
function checkAllDNSStatus() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const result = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
      const lines = hostsContent.split(/\r?\n/);
      result[tool] = hosts.every(h => lines.some((line) => lineHasOwnedHost(line, h, tool)));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map(t => [t, false]));
  }
}

/**
 * Add DNS entries for a specific tool
 */
async function addDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const snapshot = readHostsSnapshot();
  const current = snapshot.bytes.toString("utf8");
  const currentLines = current.split(/\r?\n/);
  const entriesToAdd = hosts.filter(h => !currentLines.some((line) => lineHasOwnedHost(line, h, tool)));
  const foreign = entriesToAdd.find((host) => currentLines.some((line) => lineHasExactHost(line, host)));
  if (foreign) throw new Error(`Foreign hosts mapping exists for ${foreign}; refusing to overwrite it`);
  if (entriesToAdd.length === 0) {
    log(`🌐 DNS ${tool}: already active`);
    return;
  }

  try {
    if (IS_WIN) {
      await runElevatedPowerShell(buildWindowsHostsMutationScript({
        action: "add",
        hosts: entriesToAdd,
        tag: tool,
        expectedSha256: snapshot.sha256,
      }));
    } else {
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map(h => `127.0.0.1 ${h} # ${OWNED_HOSTS_TAG}:${tool}`).join("\n");
      const next = `${trimmed}\n${toAppend}\n`;
      await commitUnixHostsAndFlush(next, sudoPassword, snapshot);
    }
    log(`🌐 DNS ${tool}: ✅ added ${entriesToAdd.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to add DNS entry: ${error.message}`;
    throw new Error(msg);
  }
}

/**
 * Remove DNS entries for a specific tool
 */
async function removeDNSEntry(tool, sudoPassword) {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const snapshot = readHostsSnapshot();
  const current = snapshot.bytes.toString("utf8");
  const currentLines = current.split(/\r?\n/);
  const entriesToRemove = hosts.filter(h => currentLines.some((line) => lineHasOwnedHost(line, h, tool)));
  if (entriesToRemove.length === 0) {
    log(`🌐 DNS ${tool}: already inactive`);
    return;
  }

  try {
    if (IS_WIN) {
      await runElevatedPowerShell(buildWindowsHostsMutationScript({
        action: "remove",
        hosts: entriesToRemove,
        tag: tool,
        expectedSha256: snapshot.sha256,
      }));
    } else {
      const filtered = current.split(/\r?\n/).filter(l => !entriesToRemove.some(h => lineHasOwnedHost(l, h, tool))).join("\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";
      await commitUnixHostsAndFlush(next, sudoPassword, snapshot);
    }
    log(`🌐 DNS ${tool}: ✅ removed ${entriesToRemove.join(", ")}`);
  } catch (error) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to remove DNS entry: ${error.message}`;
    throw new Error(msg);
  }
}

/**
 * Remove ALL tool DNS entries (used when stopping server)
 */
async function removeAllDNSEntries(sudoPassword) {
  if (IS_WIN) {
    const snapshot = readHostsSnapshot();
    const lines = snapshot.bytes.toString("utf8").split(/\r?\n/);
    const ownedEntries = Object.entries(TOOL_HOSTS).flatMap(([tag, hosts]) =>
      hosts.filter((host) => lines.some((line) => lineHasOwnedHost(line, host, tag))).map((host) => ({ host, tag }))
    );
    if (ownedEntries.length > 0) {
      await runElevatedPowerShell(buildWindowsHostsMutationScript({
        action: "remove",
        ownedEntries,
        expectedSha256: snapshot.sha256,
      }));
    }
    return;
  }
  const failures = [];
  for (const tool of Object.keys(TOOL_HOSTS)) {
    try {
      await removeDNSEntry(tool, sudoPassword);
    } catch (e) {
      err(`DNS ${tool}: failed to remove — ${e.message}`);
      failures.push({ tool, error: e });
    }
  }
  if (failures.length > 0) {
    const error = new Error(`Failed to remove ${failures.length} MITM DNS entr${failures.length === 1 ? "y" : "ies"}`);
    error.failures = failures;
    throw error;
  }
}

/**
 * Sync removal of ALL tool DNS entries — for use during process shutdown
 * when async ops aren't safe. Assumes caller already has root/admin rights.
 */
function removeAllDNSEntriesSync() {
  // Deliberately inert. The unprivileged proxy cannot safely mutate a system
  // hosts file during a synchronous exit hook; the owning manager performs the
  // authenticated, privileged cleanup before terminating the worker.
  return false;
}

module.exports = {
  TOOL_HOSTS,
  addDNSEntry,
  adoptLegacyDNSEntries,
  removeDNSEntry,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  removeLegacyDNSEntries,
  execWithPassword,
  buildUnixHostsMutationCommand,
  buildWindowsHostsMutationScript,
  isSudoAvailable,
  canRunSudoWithoutPassword,
  isSudoPasswordRequired,
  checkDNSEntry,
  checkAllDNSStatus,
  lineHasExactHost,
  lineHasOwnedHost,
  lineHasLegacyOwnedHost,
  commitUnixHostsAndFlush,
  mutateUnixHosts,
  readHostsSnapshot,
};
