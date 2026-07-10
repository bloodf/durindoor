const { execFile, execFileSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const https = require("https");
const crypto = require("crypto");
const {
  addDNSEntry,
  adoptLegacyDNSEntries,
  removeDNSEntry,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  removeLegacyDNSEntries,
  checkAllDNSStatus,
  TOOL_HOSTS,
  isSudoAvailable,
  isSudoPasswordRequired,
} = require("./dns/dnsConfig");
const { isAdmin } = require("./winElevated.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const { assertDurinDoorRootCertificate, installCert, uninstallCert } = require("./cert/install");
const { ensureRootCASync, hasValidRootCA } = require("./cert/rootCA");
const { withRootCALock } = require("./serverBootstrap");
const {
  acquireSocketLock,
  createStartGate,
  readFileSnapshot,
  releaseSocketLock,
  replaceFileIfUnchanged,
  removeFileIfUnchanged,
} = require("./startLock");
const { DATA_DIR, MITM_DIR } = require("./paths");
const { log, err } = require("./logger");
const { MITM_ENTRY_ARG, MITM_START_LOCK_PORT, MITM_NODE_PORT } = require("./config");
const {
  FIXED_UNIX_PATH,
  buildMinimalWindowsEnv,
  resolveTrustedUnixBinary,
  resolveWindowsSystemBinary,
} = require("./trustedBinaries");
const {
  buildLinuxRedirect,
  buildMacRedirect,
  buildWindowsRedirect,
  requireNumericUid,
  requireWindowsSid,
} = require("./portRedirect");
const { publishLaunchAuthorization } = require("./launchGate");
const { ensureWindowsPrivateDirectorySync } = require("./windowsAcl");
const { getProcessStartIdentity } = require("./processIdentity");

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

async function resolveMitmRouterBaseUrl() {
  if (!_getSettings) return DEFAULT_MITM_ROUTER_BASE;
  try {
    const s = await _getSettings();
    const raw = s && s.mitmRouterBaseUrl != null ? String(s.mitmRouterBaseUrl).trim() : "";
    if (!raw) return DEFAULT_MITM_ROUTER_BASE;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_MITM_ROUTER_BASE;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEFAULT_MITM_ROUTER_BASE;
  }
}

const MITM_PORT = 443;
const MITM_INTERNAL_PORT = IS_WIN ? MITM_PORT : MITM_NODE_PORT;
const PID_FILE = path.join(MITM_DIR, ".mitm.pid");
const GLOBAL_MITM_STATE_DIR = process.env.NODE_ENV !== "production" && process.env.MITM_GLOBAL_STATE_DIR
  ? path.resolve(process.env.MITM_GLOBAL_STATE_DIR)
  : process.platform === "win32"
    ? path.win32.join(os.userInfo().homedir, "AppData", "Local", "DurinDoor", "mitm-state")
    : path.join(os.userInfo().homedir, ".durindoor-mitm-state");
const REDIRECT_JOURNAL_FILE = path.join(GLOBAL_MITM_STATE_DIR, "redirect.json");

const MITM_MAX_RESTARTS = 5;
const MITM_RESTART_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];
const MITM_RESTART_RESET_MS = 60000;

let mitmRestartCount = 0;
let mitmLastStartTime = 0;
let mitmIsRestarting = false;

const STANDALONE_ROOT_ENV = "DURINDOOR_STANDALONE_ROOT";

function assertSafeServerEntrypoint(candidate, { trustedRoot = null } = {}) {
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe MITM server entrypoint: ${candidate}`);
  const realCandidate = fs.realpathSync(candidate);
  if (trustedRoot) {
    const realRoot = fs.realpathSync(trustedRoot);
    const relative = path.relative(realRoot, realCandidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Production MITM server entrypoint is outside the installed module directory");
    }
  }
  return realCandidate;
}

function resolveBundledServerPath({ allowOverride = process.env.NODE_ENV !== "production" } = {}) {
  if (allowOverride && process.env.MITM_SERVER_PATH) {
    return assertSafeServerEntrypoint(process.env.MITM_SERVER_PATH);
  }
  const sibling = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return assertSafeServerEntrypoint(sibling, { trustedRoot: __dirname });
  if (process.env.NODE_ENV === "production") {
    const standaloneRoot = process.env[STANDALONE_ROOT_ENV];
    if (standaloneRoot && path.isAbsolute(standaloneRoot)) {
      const candidate = path.join(standaloneRoot, "src", "mitm", "server.js");
      if (fs.existsSync(candidate)) {
        return assertSafeServerEntrypoint(candidate, { trustedRoot: standaloneRoot });
      }
    }
    throw new Error(`Trusted packaged MITM server entrypoint is missing: ${sibling}`);
  }
  const fromCwd = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return assertSafeServerEntrypoint(fromCwd);
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return assertSafeServerEntrypoint(fromNext);
  throw new Error(`MITM server entrypoint not found under ${process.cwd()}`);
}

function getProcessUsingPort443() {
  try {
    if (IS_WIN) {
      const powershell = resolveWindowsSystemBinary("powershell.exe");
      const pidStr = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
        "$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }"], {
        encoding: "utf8", windowsHide: true, timeout: 5000, env: buildMinimalWindowsEnv(),
      }).trim();
      const pid = parseInt(pidStr, 10);
      if (pid && pid > 4) {
        const tasklistResult = execFileSync(resolveWindowsSystemBinary("tasklist.exe"),
          ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
          { encoding: "utf8", windowsHide: true, timeout: 5000, env: buildMinimalWindowsEnv() });
        const processMatch = tasklistResult.match(/"([^"]+)"/);
        if (processMatch) return processMatch[1].replace(".exe", "");
      }
    } else {
      const result = execFileSync(resolveTrustedUnixBinary("lsof"), ["-nP", "-iTCP:443", "-sTCP:LISTEN"], {
        encoding: "utf8", windowsHide: true, timeout: 5000,
        env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
      });
      const lines = result.trim().split("\n");
      if (lines.length > 1) return lines[1].split(/\s+/)[0];
    }
  } catch {
    return null;
  }
  return null;
}

let serverProcess = null;
let serverPid = null;
let serverLauncherPid = null;
let serverInstanceNonce = null;
let serverLauncherStart = null;
let serverProcessStart = null;
let serverRedirectOwned = false;
let serverLaunchGatePath = null;

function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

function hasMitmCleanupState() {
  const dnsStatus = checkAllDNSStatus();
  return Boolean(
    serverProcess
    || serverRedirectOwned
    || fs.existsSync(PID_FILE)
    || fs.existsSync(REDIRECT_JOURNAL_FILE)
    || Object.values(dnsStatus).some(Boolean)
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // POSIX reports EPERM for a live process owned by another effective UID;
    // Windows can surface EACCES. Both mean "alive but not signalable", not
    // stale metadata.
    return err.code === "EPERM" || err.code === "EACCES";
  }
}

function parsePidRecord(raw) {
  const value = String(raw || "").trim();
  if (/^[1-9]\d*$/.test(value)) {
    const pid = Number(value);
    return { version: 0, pid, launcherPid: pid, nonce: null, state: "legacy" };
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== 1) return null;
    if (!Number.isSafeInteger(parsed?.pid) || parsed.pid <= 0) return null;
    if (!Number.isSafeInteger(parsed?.launcherPid) || parsed.launcherPid <= 0) return null;
    if (typeof parsed?.nonce !== "string" || !/^[a-f0-9]{48}$/.test(parsed.nonce)) return null;
    if (parsed.state !== "starting" && parsed.state !== "running") return null;
    if (typeof parsed.launcherStart !== "string" || parsed.launcherStart.length < 3 || parsed.launcherStart.length > 200) return null;
    if (parsed.processStart != null
      && (typeof parsed.processStart !== "string" || parsed.processStart.length < 3 || parsed.processStart.length > 200)) return null;
    return {
      version: 1,
      pid: parsed.pid,
      launcherPid: parsed.launcherPid,
      nonce: parsed.nonce,
      state: parsed.state,
      launcherStart: parsed.launcherStart,
      processStart: parsed.processStart || (parsed.pid === parsed.launcherPid ? parsed.launcherStart : null),
    };
  } catch {
    return null;
  }
}

function serializePidRecord(record) {
  return `${JSON.stringify({
    version: 1,
    pid: record.pid,
    launcherPid: record.launcherPid,
    nonce: record.nonce,
    state: record.state,
    launcherStart: record.launcherStart,
    processStart: record.processStart || (record.pid === record.launcherPid ? record.launcherStart : null),
  })}\n`;
}

function fsyncParentDirectory(filePath) {
  if (process.platform === "win32") return;
  let fd;
  try {
    fd = fs.openSync(path.dirname(filePath), "r");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readPidRecord() {
  const snapshot = readFileSnapshot(PID_FILE);
  return { snapshot, record: parsePidRecord(snapshot.raw) };
}

function pidRecordsMatch(actual, expected) {
  if (!actual || !expected) return false;
  if (actual.pid !== expected.pid) return false;
  if (expected.nonce != null && actual.nonce !== expected.nonce) return false;
  if (expected.launcherStart != null && actual.launcherStart !== expected.launcherStart) return false;
  if (expected.processStart != null && actual.processStart !== expected.processStart) return false;
  return true;
}

function removePidFileIfMatches(expectedRecord) {
  try {
    const { snapshot, record } = readPidRecord();
    if (!pidRecordsMatch(record, expectedRecord)) return false;
    return removeFileIfUnchanged(PID_FILE, snapshot);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function replacePidFileIfMatches(expectedRecord, nextRecord) {
  const { snapshot, record } = readPidRecord();
  if (!pidRecordsMatch(record, expectedRecord)) return false;

  const tempPath = `${PID_FILE}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, serializePidRecord(nextRecord));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (process.platform !== "win32") fs.chmodSync(tempPath, 0o600);
    if (!replaceFileIfUnchanged(PID_FILE, snapshot, tempPath)) return false;
    fsyncParentDirectory(PID_FILE);
    return true;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve the publication result */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* published or absent */ }
  }
}

function writeInitialPidRecord(record) {
  fs.mkdirSync(MITM_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(MITM_DIR, 0o700);
  const fd = fs.openSync(PID_FILE, "wx", 0o600);
  try {
    fs.writeFileSync(fd, serializePidRecord(record));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (process.platform !== "win32") fs.chmodSync(PID_FILE, 0o600);
  fsyncParentDirectory(PID_FILE);
}

function currentRedirectOwner() {
  return IS_WIN
    ? { kind: "sid", value: requireWindowsSid() }
    : { kind: "uid", value: String(requireNumericUid()) };
}

function parseRedirectJournal(raw) {
  try {
    const value = JSON.parse(String(raw || ""));
    if (value?.version !== 1) return null;
    if (!["installing", "installed", "uncertain"].includes(value.state)) return null;
    if (value.ownerKind !== "uid" && value.ownerKind !== "sid") return null;
    if (typeof value.ownerValue !== "string" || value.ownerValue.length < 1 || value.ownerValue.length > 200) return null;
    if (!/^[a-f0-9]{48}$/.test(value.nonce || "")) return null;
    if (value.publicPort !== MITM_PORT || value.internalPort !== MITM_INTERNAL_PORT) return null;
    return value;
  } catch {
    return null;
  }
}

function serializeRedirectJournal(record) {
  return `${JSON.stringify(record)}\n`;
}

function readRedirectJournal() {
  const snapshot = readFileSnapshot(REDIRECT_JOURNAL_FILE);
  return { snapshot, record: parseRedirectJournal(snapshot.raw) };
}

function assertRedirectJournalOwner(record) {
  if (!record) return;
  const owner = currentRedirectOwner();
  if (record.ownerKind !== owner.kind || record.ownerValue !== owner.value) {
    throw new Error("MITM redirect journal belongs to a different OS identity");
  }
}

function createRedirectJournal() {
  fs.mkdirSync(GLOBAL_MITM_STATE_DIR, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(GLOBAL_MITM_STATE_DIR);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`Unsafe global MITM state directory: ${GLOBAL_MITM_STATE_DIR}`);
  }
  if (process.platform !== "win32") {
    const uid = requireNumericUid();
    if (typeof directoryStat.uid === "number" && directoryStat.uid !== uid) {
      throw new Error("Global MITM state directory belongs to a different user");
    }
    fs.chmodSync(GLOBAL_MITM_STATE_DIR, 0o700);
  } else {
    ensureWindowsPrivateDirectorySync(GLOBAL_MITM_STATE_DIR);
  }
  const owner = currentRedirectOwner();
  const record = {
    version: 1,
    state: "installing",
    ownerKind: owner.kind,
    ownerValue: owner.value,
    publicPort: MITM_PORT,
    internalPort: MITM_INTERNAL_PORT,
    nonce: crypto.randomBytes(24).toString("hex"),
  };
  const fd = fs.openSync(REDIRECT_JOURNAL_FILE, "wx", 0o600);
  try {
    fs.writeFileSync(fd, serializeRedirectJournal(record));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (process.platform !== "win32") fs.chmodSync(REDIRECT_JOURNAL_FILE, 0o600);
  fsyncParentDirectory(REDIRECT_JOURNAL_FILE);
  return record;
}

function replaceRedirectJournalIfMatches(expectedRecord, nextRecord) {
  const { snapshot, record } = readRedirectJournal();
  if (!record || record.nonce !== expectedRecord.nonce) return false;
  const tempPath = `${REDIRECT_JOURNAL_FILE}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, serializeRedirectJournal(nextRecord));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (!replaceFileIfUnchanged(REDIRECT_JOURNAL_FILE, snapshot, tempPath)) return false;
    fsyncParentDirectory(REDIRECT_JOURNAL_FILE);
    return true;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* preserve result */ }
    try { fs.unlinkSync(tempPath); } catch { /* published or absent */ }
  }
}

function removeRedirectJournalSnapshot(snapshot, record) {
  const removed = record
    ? (() => {
      const current = readRedirectJournal();
      if (!current.record || current.record.nonce !== record.nonce) return false;
      return removeFileIfUnchanged(REDIRECT_JOURNAL_FILE, current.snapshot);
    })()
    : removeFileIfUnchanged(REDIRECT_JOURNAL_FILE, snapshot);
  if (removed) fsyncParentDirectory(REDIRECT_JOURNAL_FILE);
  return removed;
}

const startGate = createStartGate({
  acquire: () => acquireSocketLock({ port: MITM_START_LOCK_PORT }),
  release: releaseSocketLock,
  onCleanupError: async (error) => {
    err(`[MITM] Failed to release startup lock: ${error.message}`);
    await rollbackLaunchedInstance({ sudoPassword: getCachedPassword() });
  },
});

function execFileCommand(command, args, { timeout = 5000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout, encoding: "utf8", env }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function waitForProcessExit(pid, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

async function killProcess(pid, force = false, sudoPassword = null, expectedStartIdentity = null) {
  const assertIdentity = () => {
    if (expectedStartIdentity && getProcessStartIdentity(pid) !== expectedStartIdentity) {
      const error = new Error(`MITM process ${pid} identity changed before termination`);
      error.code = "MITM_PROCESS_IDENTITY_CHANGED";
      throw error;
    }
  };
  try {
    assertIdentity();
    if (IS_WIN) {
      const args = ["/PID", String(pid), "/T"];
      if (force) args.push("/F");
      await execFileCommand(resolveWindowsSystemBinary("taskkill.exe"), args, {
        timeout: 5000,
        env: buildMinimalWindowsEnv(),
      });
    } else {
      const sig = force ? "SIGKILL" : "SIGTERM";
      const pkill = resolveTrustedUnixBinary("pkill", {
        candidates: ["/usr/bin/pkill", "/bin/pkill"],
        required: false,
      });
      if (pkill) {
        try {
          assertIdentity();
          await execFileCommand(pkill, [`-${sig}`, "-P", String(pid)], {
            timeout: 3000,
            env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
          });
        } catch (error) {
          if (error.code === "MITM_PROCESS_IDENTITY_CHANGED") throw error;
          // No child process matched; continue with the authenticated parent.
        }
      }
      assertIdentity();
      try { process.kill(pid, sig); }
      catch (error) {
        if (error.code === "EPERM" || error.code === "EACCES") {
          throw new Error(`Refusing to elevate termination for unprivileged MITM process ${pid}`);
        }
        if (error.code !== "ESRCH") throw error;
      }
    }
  } catch (error) {
    // A process can exit between the liveness probe and the kill command.
    if (isProcessAlive(pid)) throw error;
  }

  if (force && !(await waitForProcessExit(pid))) {
    throw new Error(`MITM process ${pid} remained alive after forced termination`);
  }
}

async function rollbackLaunchedInstance({
  launchedProcess = serverProcess,
  launcherPid = serverLauncherPid,
  actualPid = serverPid,
  nonce = serverInstanceNonce,
  sudoPassword = null,
  redirectOwned = serverRedirectOwned,
  launchGatePath = serverLaunchGatePath,
  launcherStart = serverLauncherStart,
  actualStart = serverProcessStart,
} = {}) {
  if (launchGatePath) {
    try { fs.unlinkSync(launchGatePath); } catch { /* consumed or absent */ }
  }
  const ownedProcesses = [];
  if (Number.isSafeInteger(actualPid) && actualPid > 0) {
    ownedProcesses.push({ pid: actualPid, start: actualStart || (actualPid === launcherPid ? launcherStart : null) });
  }
  if (Number.isSafeInteger(launcherPid) && launcherPid > 0 && launcherPid !== actualPid) {
    ownedProcesses.push({ pid: launcherPid, start: launcherStart });
  }
  if (launchedProcess && !launchedProcess.killed) {
    if (!launcherStart || getProcessStartIdentity(launchedProcess.pid) === launcherStart) {
      try { launchedProcess.kill("SIGKILL"); } catch { /* verified below */ }
    }
  }
  for (const owned of ownedProcesses) {
    if (isProcessAlive(owned.pid)) {
      if (!owned.start) throw new Error(`Missing process-start identity for MITM PID ${owned.pid}`);
      await killProcess(owned.pid, true, sudoPassword, owned.start);
    }
  }
  if (redirectOwned) {
    await removeAllDNSEntries(sudoPassword || getCachedPassword());
    await removePortRedirect(sudoPassword);
  }
  for (const owned of ownedProcesses) {
    try { removePidFileIfMatches({ pid: owned.pid, nonce }); } catch { /* preserve rollback progress */ }
  }

  if (nonce == null || serverInstanceNonce === nonce || serverProcess === launchedProcess) {
    serverProcess = null;
    serverPid = null;
    serverLauncherPid = null;
    serverInstanceNonce = null;
    serverLauncherStart = null;
    serverProcessStart = null;
    serverRedirectOwned = false;
    serverLaunchGatePath = null;
  }
}

async function throwAfterRollback(primaryError, rollbackOptions) {
  try {
    await rollbackLaunchedInstance(rollbackOptions);
  } catch (cleanupError) {
    primaryError.cleanupError = cleanupError;
  }
  throw primaryError;
}

let _getSettings = null;
let _updateSettings = null;

function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

async function saveMitmSettings(enabled) {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ mitmEnabled: enabled, mitmSudoEncrypted: null });
  } catch (e) {
    err(`Failed to save settings: ${e.message}`);
    throw e;
  }
}

async function clearEncryptedPassword() {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ mitmSudoEncrypted: null });
  } catch (e) {
    err(`Failed to clear legacy stored sudo credential: ${e.message}`);
    throw e;
  }
}

async function loadEncryptedPassword() {
  if (!_getSettings) return null;
  try {
    const settings = await _getSettings();
    if (settings.mitmSudoEncrypted) {
      if (!_updateSettings) throw new Error("Settings writer unavailable for legacy sudo credential purge");
      await _updateSettings({ mitmSudoEncrypted: null });
    }
    return null;
  } catch (error) {
    err(`Failed to purge legacy stored sudo credential: ${error.message}`);
    throw error;
  }
}

async function getInMemoryPassword(provided = null) {
  await loadEncryptedPassword();
  return provided || getCachedPassword() || null;
}

async function saveDnsToolState(tool, enabled) {
  if (!_updateSettings || !_getSettings) return;
  try {
    const s = await _getSettings();
    const next = { ...(s.dnsToolEnabled || {}), [tool]: enabled };
    await _updateSettings({ dnsToolEnabled: next });
  } catch (e) {
    err(`Failed to save DNS state: ${e.message}`);
    throw e;
  }
}

async function loadDnsToolState() {
  if (!_getSettings) return {};
  try {
    const s = await _getSettings();
    return s.dnsToolEnabled || {};
  } catch {
    return {};
  }
}

/**
 * Re-apply DNS for tools previously enabled — called on app startup after MITM running.
 */
async function restoreToolDNS(sudoPassword) {
  return startGate.runAfterIdle(async () => {
    const status = await getMitmStatus();
    if (!status.running) throw new Error("MITM server is not running; refusing to restore DNS entries");
    const state = await loadDnsToolState();
    const password = await getInMemoryPassword(sudoPassword);
    for (const tool of Object.keys(TOOL_HOSTS)) {
      const enabled = state[tool] === true;
      try {
        if (enabled) {
          await adoptLegacyDNSEntries(tool, password);
          await addDNSEntry(tool, password);
        }
        else await removeDNSEntry(tool, password);
      } catch (e) {
        err(`DNS ${tool}: restore failed — ${e.message}`);
      }
    }
  });
}

/**
 * Check if user has privilege to mutate hosts file.
 * Windows: standard-user parent with narrow UAC. Mac/Linux: standard-user
 * parent with passwordless sudo or an in-memory sudo credential.
 */
async function hasDnsPrivilege() {
  if (IS_WIN) return !isAdmin();
  if (isAdmin()) return false;
  if (!isSudoPasswordRequired()) return true;
  const pwd = await getInMemoryPassword();
  return !!pwd;
}

function checkLoopbackPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission");
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(port, "127.0.0.1");
  });
}

function checkPort443Free() { return checkLoopbackPortFree(MITM_PORT); }

function getPort443Owner(sudoPassword) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      const powershell = resolveWindowsSystemBinary("powershell.exe");
      execFile(powershell, ["-NoProfile", "-NonInteractive", "-Command",
        "$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }"], {
        windowsHide: true, timeout: 5000, encoding: "utf8", env: buildMinimalWindowsEnv(),
      }, (err, stdout) => {
        if (err) return resolve(null);
        const pid = parseInt(stdout.trim(), 10);
        if (!pid || pid <= 4) return resolve(null);
        execFile(resolveWindowsSystemBinary("tasklist.exe"), ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
          windowsHide: true, timeout: 5000, encoding: "utf8", env: buildMinimalWindowsEnv(),
        }, (e2, out2) => {
          const m = out2?.match(/"([^"]+)"/);
          const startIdentity = getProcessStartIdentity(pid);
          resolve(startIdentity ? { pid, name: m ? m[1] : "unknown", startIdentity } : null);
        });
      });
    } else {
      // Only find process actually LISTENING on TCP port 443
      let lsof;
      try { lsof = resolveTrustedUnixBinary("lsof"); } catch { resolve(null); return; }
      execFile(lsof, ["-nP", "-iTCP:443", "-sTCP:LISTEN", "-t"], {
        windowsHide: true, timeout: 5000, encoding: "utf8",
        env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
      }, (err, stdout) => {
        if (err || !stdout?.trim()) return resolve(null);
        const pid = parseInt(stdout.trim().split("\n")[0], 10);
        if (!pid || isNaN(pid)) return resolve(null);
        execFile(resolveTrustedUnixBinary("ps"), ["-p", String(pid), "-o", "comm="], {
          windowsHide: true, timeout: 5000, encoding: "utf8",
          env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
        }, (e2, out2) => {
          const startIdentity = getProcessStartIdentity(pid);
          resolve(startIdentity ? { pid, name: (out2?.trim() || "unknown"), startIdentity } : null);
        });
      });
    }
  });
}

async function killLeftoverMitm(sudoPassword, { preserveRedirectForRestart = mitmIsRestarting && serverRedirectOwned } = {}) {
  if (!fs.existsSync(PID_FILE)) {
    if (fs.existsSync(REDIRECT_JOURNAL_FILE)) {
      await removeAllDNSEntries(sudoPassword || getCachedPassword());
      await removePortRedirect(sudoPassword);
      serverRedirectOwned = false;
    }
    return;
  }

  const { snapshot, record } = readPidRecord();
  if (!record) {
    await removeAllDNSEntries(sudoPassword || getCachedPassword());
    await removePortRedirect(sudoPassword);
    if (!removeFileIfUnchanged(PID_FILE, snapshot)) {
      throw new Error("Malformed MITM PID metadata changed during cleanup");
    }
    serverRedirectOwned = false;
    return;
  }

  if (record.version === 0) {
    if (isProcessAlive(record.pid)) {
      const error = new Error(`Legacy MITM process ${record.pid} is alive but lacks authenticated ownership metadata`);
      error.code = "MITM_OWNERSHIP_UNVERIFIED";
      throw error;
    }
    await removeLegacyDNSEntries(sudoPassword || getCachedPassword());
    await removeAllDNSEntries(sudoPassword || getCachedPassword());
    if (fs.existsSync(REDIRECT_JOURNAL_FILE)) await removePortRedirect(sudoPassword);
    if (!removePidFileIfMatches(record)) throw new Error("Legacy MITM PID metadata changed during cleanup");
    return;
  }

  const health = await pollMitmHealth(1500, MITM_INTERNAL_PORT, record.nonce);
  const healthPid = Number.isSafeInteger(health?.pid) && health.pid > 0 ? health.pid : null;
  const healthMatches = record.state === "starting" ? healthPid != null : healthPid === record.pid;
  const launcherMatches = isProcessAlive(record.launcherPid)
    && getProcessStartIdentity(record.launcherPid) === record.launcherStart;

  if (healthMatches) {
    const processStart = record.processStart
      || await bindAuthenticatedProcessIdentity(healthPid, record.nonce, MITM_INTERNAL_PORT);
    if (!processStart || getProcessStartIdentity(healthPid) !== processStart) {
      throw new Error(`MITM process ${healthPid} start identity could not be authenticated`);
    }
    await killProcess(healthPid, true, sudoPassword, processStart);
    if (record.launcherPid !== healthPid && launcherMatches) {
      await killProcess(record.launcherPid, true, sudoPassword, record.launcherStart);
    }
  } else if (record.state === "starting" && launcherMatches) {
    await killProcess(record.launcherPid, true, sudoPassword, record.launcherStart);
  } else if (isProcessAlive(record.pid) || isProcessAlive(record.launcherPid)) {
    const error = new Error(`MITM process ${record.pid} is alive but ownership is unverified`);
    error.code = "MITM_OWNERSHIP_UNVERIFIED";
    throw error;
  }

  const preserveOwnedRedirect = preserveRedirectForRestart;
  if (!preserveOwnedRedirect) {
    await removeAllDNSEntries(sudoPassword || getCachedPassword());
    await removePortRedirect(sudoPassword);
    serverRedirectOwned = false;
  }
  if (!removePidFileIfMatches(record)) throw new Error("MITM PID metadata changed during cleanup");

  serverProcess = null;
  serverPid = null;
  serverLauncherPid = null;
  serverInstanceNonce = null;
  serverLauncherStart = null;
  serverProcessStart = null;
}

function pollMitmHealth(timeoutMs, port = MITM_PORT, expectedNonce = null) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const check = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        finish(null);
        return;
      }
      let attemptComplete = false;
      let wallTimer = null;
      const challenge = expectedNonce ? crypto.randomBytes(32).toString("hex") : null;
      const retry = () => {
        if (attemptComplete || settled) return;
        attemptComplete = true;
        if (wallTimer) clearTimeout(wallTimer);
        if (Date.now() < deadline) setTimeout(check, Math.min(100, Math.max(1, deadline - Date.now())));
        else finish(null);
      };
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/_mitm_health",
          method: "GET",
          rejectUnauthorized: false,
          headers: challenge ? { "x-durindoor-mitm-challenge": challenge } : {},
        },
        (res) => {
          let body = "";
          res.on("data", (d) => {
            body += d;
            if (body.length > 4096) req.destroy(new Error("MITM health response too large"));
          });
          res.on("end", () => {
            if (attemptComplete || settled) return;
            attemptComplete = true;
            if (wallTimer) clearTimeout(wallTimer);
            try {
              const json = JSON.parse(body);
              let proofMatches = expectedNonce == null;
              if (expectedNonce != null && /^[a-f0-9]{64}$/.test(json.proof || "")) {
                const expectedProof = crypto.createHmac("sha256", expectedNonce).update(challenge).digest("hex");
                proofMatches = crypto.timingSafeEqual(Buffer.from(json.proof), Buffer.from(expectedProof));
              }
              finish(json.ok === true && proofMatches
                ? { ok: true, pid: json.pid || null }
                : null);
            } catch { finish(null); }
          });
          res.on("error", retry);
        }
      );
      req.setTimeout?.(Math.min(500, remaining), () => {
        req.destroy?.(Object.assign(new Error("MITM health request timed out"), { code: "ETIMEDOUT" }));
        retry();
      });
      req.on("error", retry);
      wallTimer = setTimeout(() => {
        req.destroy?.(Object.assign(new Error("MITM health attempt deadline exceeded"), { code: "ETIMEDOUT" }));
        retry();
      }, Math.min(500, remaining));
      req.end();
    };
    check();
  });
}

async function bindAuthenticatedProcessIdentity(pid, nonce, port = MITM_INTERNAL_PORT) {
  const startIdentity = getProcessStartIdentity(pid);
  if (!startIdentity) return null;
  const confirmation = await pollMitmHealth(1500, port, nonce);
  if (confirmation?.pid !== pid || getProcessStartIdentity(pid) !== startIdentity) return null;
  return startIdentity;
}

/**
 * Get full MITM status including per-tool DNS status
 */
async function getMitmStatus() {
  let running = false;
  let pid = null;

  try {
    if (fs.existsSync(PID_FILE)) {
      const { record } = readPidRecord();
      if (record?.nonce && (record.state === "starting" || isProcessAlive(record.pid))) {
        const directHealth = await pollMitmHealth(1500, MITM_INTERNAL_PORT, record.nonce);
        const directMatches = record.state === "starting"
          ? Number.isSafeInteger(directHealth?.pid) && directHealth.pid > 0
          : directHealth?.pid === record.pid;
        const publicHealth = directMatches
          ? await pollMitmHealth(1500, MITM_PORT, record.nonce)
          : null;
        if (directMatches && publicHealth?.pid === directHealth.pid) {
          running = true;
          pid = directHealth.pid;
        }
      } else if (record?.version === 0 && isProcessAlive(record.pid)) {
        const health = await pollMitmHealth(1500, MITM_PORT, null);
        if (health?.pid === record.pid) {
          running = true;
          pid = record.pid;
        }
      }
    }
  } catch { /* status is fail-closed */ }

  const dnsStatus = checkAllDNSStatus();
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const certExists = fs.existsSync(rootCACertPath);
  const { checkCertInstalled } = require("./cert/install");
  const certTrusted = certExists ? await checkCertInstalled(rootCACertPath) : false;

  return { running, pid, certExists, certTrusted, dnsStatus };
}

async function scheduleMitmRestart(apiKey) {
  if (mitmIsRestarting) return;
  // Set guard synchronously before any await to prevent concurrent calls
  // from passing the check above.
  mitmIsRestarting = true;

  const aliveMs = Date.now() - mitmLastStartTime;
  if (aliveMs >= MITM_RESTART_RESET_MS) mitmRestartCount = 0;

  if (mitmRestartCount >= MITM_MAX_RESTARTS) {
    err("Max restart attempts reached. Giving up.");
    try { await cleanupRestartTerminalState("restart attempts exhausted"); }
    catch (error) { err(`Terminal restart cleanup failed; ownership state was retained: ${error.message}`); }
    mitmIsRestarting = false;
    return;
  }

  const attempt = mitmRestartCount;
  const delay = MITM_RESTART_DELAYS_MS[Math.min(attempt, MITM_RESTART_DELAYS_MS.length - 1)];
  mitmRestartCount++;

  log(`Restarting in ${delay / 1000}s... (${mitmRestartCount}/${MITM_MAX_RESTARTS})`);
  await new Promise((r) => setTimeout(r, delay));

  try {
    const settings = _getSettings ? await _getSettings() : null;
    if (settings && !settings.mitmEnabled) {
      log("MITM disabled, skipping restart");
      await cleanupRestartTerminalState("MITM disabled during restart");
      mitmIsRestarting = false;
      return;
    }
    const password = getCachedPassword();
    if (IS_WIN && !serverRedirectOwned) {
      err("MITM isolation is no longer owned; a fresh user-approved Windows start is required");
      await cleanupRestartTerminalState("Windows redirect ownership lost");
      mitmIsRestarting = false;
      return;
    }
    if (!serverRedirectOwned && !password && !IS_WIN && isSudoPasswordRequired()) {
      err("No in-memory sudo credential is available to restore the MITM redirect");
      await cleanupRestartTerminalState("sudo credential unavailable");
      mitmIsRestarting = false;
      return;
    }
    await startServer(apiKey, password);
    log("🔄 Restarted successfully");
    mitmRestartCount = 0;
    mitmIsRestarting = false;
  } catch (e) {
    err(`Restart attempt ${mitmRestartCount}/${MITM_MAX_RESTARTS} failed: ${e.message}`);
    mitmIsRestarting = false;
    // Schedule next retry
    scheduleMitmRestart(apiKey);
  }
}

async function cleanupRestartTerminalState(reason) {
  return startGate.runAfterIdle(async () => {
    // Persist the terminal state before removing the live recovery surface.
    // If persistence fails, retain every ownership artifact for a safe retry.
    await saveMitmSettings(false);
    await killLeftoverMitm(getCachedPassword(), { preserveRedirectForRestart: false });
    setCachedPassword(null);
    log(`MITM disabled after terminal restart state: ${reason}`);
  });
}

/**
 * Start MITM server only (cert + server, no DNS)
 */
async function killPort443Owner(owner, sudoPassword) {
  if (!owner || !owner.pid) return;
  const currentOwner = await getPort443Owner(sudoPassword);
  if (!currentOwner
    || currentOwner.pid !== owner.pid
    || currentOwner.startIdentity !== owner.startIdentity) {
    const error = new Error("Port 443 ownership changed before the approved process could be stopped.");
    error.code = "PORT_443_BUSY";
    error.portOwner = currentOwner || null;
    throw error;
  }
  await killProcess(owner.pid, true, sudoPassword, owner.startIdentity);
  await new Promise(r => setTimeout(r, 800));
  if (isProcessAlive(owner.pid)) throw new Error(`Approved port owner ${owner.pid} remained alive after termination`);
}

async function cleanupPendingTrustRotations(sudoPassword, { replacementTrusted = false } = {}) {
  if (!replacementTrusted) {
    throw new Error("Refusing to remove previous Root CA trust before replacement trust is verified");
  }
  if (!fs.existsSync(MITM_DIR)) return;
  const pending = fs.readdirSync(MITM_DIR)
    .filter((name) => /^\.rootCA\.previous\.[a-f0-9.]+\.crt$/.test(name));
  for (const name of pending) {
    const certPath = path.join(MITM_DIR, name);
    const stat = fs.lstatSync(certPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Unsafe pending Root CA trust journal: ${certPath}`);
    }
    const password = await getInMemoryPassword(sudoPassword);
    await uninstallCert(password, certPath);
    fs.unlinkSync(certPath);
  }
}

function publishTrustRotationJournal(sourcePath, journalPath) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Unsafe Root CA certificate path: ${sourcePath}`);
  }
  const sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let journalFd;
  try {
    const openedStat = fs.fstatSync(sourceFd);
    if (!openedStat.isFile()
      || String(openedStat.dev) !== String(sourceStat.dev)
      || String(openedStat.ino) !== String(sourceStat.ino)) {
      throw new Error("Root CA certificate changed while journaling trust rotation");
    }
    const bytes = fs.readFileSync(sourceFd);
    journalFd = fs.openSync(journalPath, "wx", 0o600);
    fs.writeFileSync(journalFd, bytes);
    fs.fsyncSync(journalFd);
    fs.closeSync(journalFd);
    journalFd = undefined;
    if (process.platform !== "win32") fs.chmodSync(journalPath, 0o600);
    fsyncParentDirectory(journalPath);
  } catch (error) {
    if (journalFd !== undefined) try { fs.closeSync(journalFd); } catch { /* preserve error */ }
    try { fs.unlinkSync(journalPath); } catch { /* absent or cleanup failure */ }
    throw error;
  } finally {
    fs.closeSync(sourceFd);
  }
}

async function mutatePortRedirect(action, sudoPassword, { allowExisting = true } = {}) {
  if (IS_WIN) {
    const { runElevatedPowerShell } = require("./winElevated.js");
    const sid = requireWindowsSid();
    await runElevatedPowerShell(buildWindowsRedirect({ sid, publicPort: MITM_PORT, allowExisting })[action]);
    return;
  }
  if (!isSudoAvailable()) {
    if (action === "remove") return;
    throw new Error("sudo is required to redirect local port 443 to the unprivileged MITM server");
  }
  const { execWithPassword } = require("./dns/dnsConfig");
  const uid = requireNumericUid();
  const redirect = IS_MAC
    ? buildMacRedirect({ uid, publicPort: MITM_PORT, internalPort: MITM_NODE_PORT, allowExisting })
    : buildLinuxRedirect({ uid, publicPort: MITM_PORT, internalPort: MITM_NODE_PORT, allowExisting });
  // The diagnostic operation tag is ignored by the production executor but
  // lets platform-neutral tests inject install and rollback outcomes without
  // guessing from shell text that legitimately contains its own cleanup trap.
  await execWithPassword(redirect[action], sudoPassword || "", {
    operation: action,
    scope: "mitm-port-redirect",
  });
}

async function installPortRedirect(sudoPassword) {
  let journal;
  let hadJournal = false;
  let createdJournal = false;
  let mutationDispatched = false;
  try {
    try {
      ({ record: journal } = readRedirectJournal());
      if (!journal) throw new Error("Malformed MITM redirect ownership journal");
      assertRedirectJournalOwner(journal);
      if (journal.state === "installing" || journal.state === "uncertain") {
        if (journal.state === "installing") {
          const quarantined = { ...journal, state: "uncertain" };
          if (!replaceRedirectJournalIfMatches(journal, quarantined)) {
            const changed = new Error("A stale installing journal changed before it could be quarantined");
            changed.code = "MITM_PRIVILEGED_OPERATION_UNCERTAIN";
            throw changed;
          }
          journal = quarantined;
        }
        const uncertain = new Error("A previous privileged MITM operation has an unconfirmed outcome; reboot and perform the documented manual recovery before retrying");
        uncertain.code = "MITM_PRIVILEGED_OPERATION_UNCERTAIN";
        throw uncertain;
      }
      hadJournal = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      journal = createRedirectJournal();
      createdJournal = true;
    }

    mutationDispatched = true;
    await mutatePortRedirect("install", sudoPassword, { allowExisting: hadJournal });
    if (journal.state === "installing") {
      const installed = { ...journal, state: "installed" };
      if (!replaceRedirectJournalIfMatches(journal, installed)) {
        throw new Error("MITM redirect journal changed before installation commit");
      }
      journal = installed;
    }
  } catch (error) {
    if (error.code === "MITM_PRIVILEGED_OPERATION_UNCERTAIN") throw error;
    if (error.code === "PRIVILEGED_TERMINATION_UNCONFIRMED") {
      // The wrapper could have returned while a privileged descendant was
      // still running. Persist an irreversible quarantine marker: neither a
      // start nor a stop may race that process with an inverse mutation.
      const uncertainJournal = { ...journal, state: "uncertain" };
      let quarantineError = null;
      if (!journal || !replaceRedirectJournalIfMatches(journal, uncertainJournal)) {
        quarantineError = new Error("MITM redirect journal could not be quarantined after an unconfirmed privileged operation");
      }
      const uncertain = new Error("Privileged MITM mutation outcome is unconfirmed; reboot and perform the documented manual recovery before retrying");
      uncertain.code = "MITM_PRIVILEGED_OPERATION_UNCERTAIN";
      uncertain.cause = error;
      if (quarantineError) uncertain.cleanupError = quarantineError;
      throw uncertain;
    }
    try {
      // A normal rejection means the privileged process tree has closed. It is
      // now safe to run the exact inverse operation and discard our journal.
      if (mutationDispatched) await mutatePortRedirect("remove", sudoPassword);
      if ((mutationDispatched || createdJournal) && journal) {
        const current = readRedirectJournal();
        if (current.record?.nonce === journal.nonce
          && !removeRedirectJournalSnapshot(current.snapshot, current.record)) {
          throw new Error("MITM redirect journal changed during failed-install cleanup");
        }
      }
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
      // Preserve the journal as recovery authority when cleanup is incomplete.
      throw error;
    }
    throw error;
  }
}

async function removePortRedirect(sudoPassword) {
  let snapshot = null;
  let journal = null;
  try {
    ({ snapshot, record: journal } = readRedirectJournal());
    if (journal) {
      assertRedirectJournalOwner(journal);
      if (journal.state === "installing" || journal.state === "uncertain") {
        if (journal.state === "installing") {
          const quarantined = { ...journal, state: "uncertain" };
          if (!replaceRedirectJournalIfMatches(journal, quarantined)) {
            const changed = new Error("A stale installing journal changed before it could be quarantined");
            changed.code = "MITM_PRIVILEGED_OPERATION_UNCERTAIN";
            throw changed;
          }
          journal = quarantined;
        }
        const uncertain = new Error("Refusing cleanup while a previous privileged MITM operation has an unconfirmed outcome; reboot and perform the documented manual recovery");
        uncertain.code = "MITM_PRIVILEGED_OPERATION_UNCERTAIN";
        throw uncertain;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await mutatePortRedirect("remove", sudoPassword);
  if (snapshot && !removeRedirectJournalSnapshot(snapshot, journal)) {
    throw new Error("MITM redirect journal changed during cleanup");
  }
}

async function startServer(apiKey, sudoPassword, forceKillPort443 = false) {
  return startGate.run(async () => {
  // The full proxy and all user-owned files must stay unprivileged. Refuse an
  // elevated parent before reading or mutating PID, CA, trust, DNS, redirect,
  // or process state.
  if (isAdmin()) {
    const error = new Error("Refusing to run the full MITM proxy with an elevated parent; start DurinDoor as a standard user");
    error.code = "MITM_ELEVATED_PARENT_UNSAFE";
    throw error;
  }

  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const { snapshot, record } = readPidRecord();
        if (record?.nonce) {
          const health = await pollMitmHealth(1500, MITM_INTERNAL_PORT, record.nonce);
          const runningMatches = record.state === "running" && health?.pid === record.pid;
          const startingMatches = record.state === "starting"
            && Number.isSafeInteger(health?.pid)
            && health.pid > 0;
          if (runningMatches || startingMatches) {
            const reusableRecord = startingMatches
              ? {
                ...record,
                pid: health.pid,
                state: "running",
                // A bootstrap manager and its serving child can have distinct
                // PIDs. Never carry the launcher's identity onto that child.
                processStart: health.pid === record.pid ? record.processStart : null,
              }
              : record;
            const reusableProcessStart = reusableRecord.processStart
              || await bindAuthenticatedProcessIdentity(reusableRecord.pid, reusableRecord.nonce, MITM_INTERNAL_PORT);
            if (!reusableProcessStart
              || getProcessStartIdentity(reusableRecord.pid) !== reusableProcessStart) {
              throw new Error("Existing MITM process start identity could not be authenticated");
            }
            reusableRecord.processStart = reusableProcessStart;
            if (startingMatches && !replacePidFileIfMatches(record, reusableRecord)) {
              throw new Error("Recovered MITM server PID could not be recorded safely");
            }
            let installedHere = false;
            try {
              if (!serverRedirectOwned) {
                await installPortRedirect(sudoPassword);
                installedHere = true;
              }
              const publicHealth = await pollMitmHealth(1500, MITM_PORT, reusableRecord.nonce);
              if (publicHealth?.pid !== reusableRecord.pid) {
                const error = new Error("Existing MITM process is healthy, but its authenticated public-port redirect is not");
                error.code = "MITM_REDIRECT_UNHEALTHY";
                throw error;
              }
            } catch (error) {
              if (installedHere) {
                try { await removePortRedirect(sudoPassword); }
                catch (cleanupError) { error.cleanupError = cleanupError; }
              }
              throw error;
            }
            serverPid = reusableRecord.pid;
            serverLauncherPid = reusableRecord.launcherPid;
            serverInstanceNonce = reusableRecord.nonce;
            serverLauncherStart = reusableRecord.launcherStart;
            serverProcessStart = reusableProcessStart;
            serverRedirectOwned = true;
            log(`♻️ Reusing existing process (PID: ${reusableRecord.pid})`);
            try {
              await saveMitmSettings(true);
            } catch (error) {
              await throwAfterRollback(error, {
                actualPid: reusableRecord.pid,
                launcherPid: reusableRecord.launcherPid,
                nonce: reusableRecord.nonce,
                sudoPassword,
                redirectOwned: true,
              });
            }
            if (sudoPassword) setCachedPassword(sudoPassword);
            return { running: true, pid: reusableRecord.pid };
          }
          log(`[MITM] Refusing to reuse unverified PID ${record.pid}`);
        } else if (record?.version === 0 && isProcessAlive(record.pid)) {
          const error = new Error(`Legacy MITM PID ${record.pid} has no nonce/start identity and cannot be adopted safely`);
          error.code = "MITM_OWNERSHIP_UNVERIFIED";
          throw error;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM server is already running");
  }

  if (!IS_WIN) {
    const internalPortStatus = await checkLoopbackPortFree(MITM_INTERNAL_PORT);
    if (internalPortStatus !== "free") {
      const error = new Error(`Internal MITM port ${MITM_INTERNAL_PORT} is already in use; refusing cross-DATA_DIR redirect adoption`);
      error.code = "MITM_INTERNAL_PORT_BUSY";
      throw error;
    }
  } else {
    const incumbentStatus = await checkPort443Free();
    const hasRecoveryEvidence = fs.existsSync(PID_FILE)
      || fs.existsSync(REDIRECT_JOURNAL_FILE)
      || Object.values(checkAllDNSStatus()).some(Boolean);
    if (incumbentStatus === "in-use" && hasRecoveryEvidence) {
      const error = new Error("Port 443 is already occupied by an incumbent process; refusing stale cross-DATA_DIR cleanup");
      error.code = "PORT_443_BUSY";
      throw error;
    }
  }

  // Only reconcile stale local journals after proving that no incumbent proxy
  // from another DATA_DIR is listening on the per-user global transport.
  await killLeftoverMitm(sudoPassword);

  if (!IS_WIN && await checkLoopbackPortFree(MITM_INTERNAL_PORT) !== "free") {
    const error = new Error(`Internal MITM port ${MITM_INTERNAL_PORT} became busy during startup`);
    error.code = "MITM_INTERNAL_PORT_BUSY";
    throw error;
  }

  const portStatus = await checkPort443Free();
  if (portStatus === "in-use" || portStatus === "no-permission") {
    const owner = await getPort443Owner(sudoPassword);
    if (owner) {
      const shortName = owner.name.includes("/")
        ? owner.name.split("/").filter(Boolean).pop()
        : owner.name;
      if (forceKillPort443) {
        log(`Killing process on port 443 (PID ${owner.pid}, name=${shortName})...`);
        await killPort443Owner(owner, sudoPassword);
      } else {
        const e = new Error(`Port 443 is already in use by "${shortName}" (PID ${owner.pid}).`);
        e.code = "PORT_443_BUSY";
        e.portOwner = { pid: owner.pid, name: shortName };
        throw e;
      }
    } else if (portStatus === "in-use") {
      const error = new Error("Port 443 is in use, but its process identity could not be verified safely");
      error.code = "PORT_443_BUSY";
      error.portOwner = null;
      throw error;
    }
  }

  // Step 1: Generate Root CA if missing, invalid, mismatched, or expiring.
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const generatedRootCA = await withRootCALock(async () => {
    const oldCertExists = fs.existsSync(rootCACertPath);
    const needsReplacement = !hasValidRootCA();
    let previousCertPath = null;
    let replacementPublished = false;
    try {
      let oldCertIsTrustable = false;
      if (needsReplacement && oldCertExists) {
        try {
          assertDurinDoorRootCertificate(rootCACertPath);
          oldCertIsTrustable = true;
        } catch (error) {
          log(`🔐 Cert: invalid prior certificate will be replaced without trust cleanup (${error.message})`);
        }
      }
      if (needsReplacement && oldCertIsTrustable) {
        // Preserve the old certificate until the replacement pair is fully
        // published. A generation failure must not remove the usable trust
        // registration for the pair that rootCA.js restores on disk.
        previousCertPath = path.join(
          MITM_DIR,
          `.rootCA.previous.${process.pid}.${crypto.randomBytes(8).toString("hex")}.crt`,
        );
        publishTrustRotationJournal(rootCACertPath, previousCertPath);
      }

      let generated;
      try {
        generated = ensureRootCASync();
        replacementPublished = generated;
      } catch (error) {
        replacementPublished = error?.rootCAPublished === true;
        throw error;
      }
      return generated;
    } finally {
      if (previousCertPath && !replacementPublished) {
        try { fs.unlinkSync(previousCertPath); } catch { /* public cert cleanup is best effort */ }
      }
    }
  });
  if (generatedRootCA) log("🔐 Generated Root CA");

  // Step 1.5: Auto-install Root CA if not trusted yet
  const { checkCertInstalled } = require("./cert/install");
  let rootCATrusted = await checkCertInstalled(rootCACertPath);
  const linuxNoSystemTrust = !IS_WIN && !IS_MAC && !isSudoAvailable();
  if (!rootCATrusted) {
    log("🔐 Cert: not trusted → installing...");
    const password = await getInMemoryPassword(sudoPassword);
    if (linuxNoSystemTrust) {
      await installCert(null, rootCACertPath);
      rootCATrusted = await checkCertInstalled(rootCACertPath);
      if (!rootCATrusted) {
        log(`🔐 Cert: no verifiable local trust store (no sudo). Install ${rootCACertPath} as a trusted CA on machines that use this proxy.`);
      }
    } else {
      if (!password && isSudoPasswordRequired()) {
        throw new Error("Sudo password required to install Root CA certificate");
      }
      try {
        await installCert(password, rootCACertPath);
        rootCATrusted = await checkCertInstalled(rootCACertPath);
        if (!rootCATrusted) throw new Error("replacement trust could not be verified after installation");
        log("🔐 Cert: ✅ trusted");
      } catch (e) {
        throw new Error(`Failed to trust certificate: ${e.message}`);
      }
    }
  } else {
    log("🔐 Cert: already trusted ✅");
  }

  // Only after the replacement certificate is demonstrably trusted may the
  // previous trust entry and its exact-certificate journal be removed. A UAC,
  // sudo, or verification failure leaves the old trust available for retry.
  if (rootCATrusted) {
    await withRootCALock(() => cleanupPendingTrustRotations(sudoPassword, {
      replacementTrusted: true,
    }));
  }

  // Step 2: spawn the full proxy as the standard user after narrow system
  // configuration has succeeded.
  const effectiveServerPath = resolveBundledServerPath();
  if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
    throw new Error(`MITM server.js not found at ${effectiveServerPath}. Reinstall DurinDoor.`);
  }
  const mitmRouterBase = await resolveMitmRouterBaseUrl();
  const instanceNonce = crypto.randomBytes(24).toString("hex");
  serverLaunchGatePath = path.join(MITM_DIR, `.launch.${instanceNonce}.gate`);
  let startError = null;
  let spawnFailure = null;
  const trackSpawn = (child) => {
    child?.once("error", (error) => {
      spawnFailure = error;
      startError = error.message;
      err(`[MITM] Server process error: ${error.message}`);
    });
    return child;
  };
  log(`🚀 Starting server... (router: ${mitmRouterBase})`);
  if (!serverRedirectOwned) {
    await installPortRedirect(sudoPassword);
    serverRedirectOwned = true;
  }
  const trustedChildPlatformEnv = IS_WIN
    ? buildMinimalWindowsEnv()
    : { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" };
  const childEnv = Object.fromEntries(Object.entries({
    ...trustedChildPlatformEnv,
    HOME: os.homedir(),
    DATA_DIR,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ROUTER_API_KEY: apiKey,
    NODE_ENV: "production",
    MITM_ROUTER_BASE: mitmRouterBase,
    MITM_INSTANCE_NONCE: instanceNonce,
    MITM_LAUNCH_GATE_FILE: serverLaunchGatePath,
    MITM_MANAGER_PID: String(process.pid),
    MITM_CA_PREPARED: "1",
    MITM_LISTEN_PORT: String(MITM_INTERNAL_PORT),
  }).filter(([, value]) => value != null));
  try {
    serverProcess = trackSpawn(spawn(process.execPath, [effectiveServerPath, MITM_ENTRY_ARG], {
      detached: false,
      windowsHide: true,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    }));
  } catch (error) {
    try {
      await removePortRedirect(sudoPassword);
      serverRedirectOwned = false;
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }

  const launchedProcess = serverProcess;
  let startupComplete = false;
  let exitedDuringStartup = false;

  if (!launchedProcess?.pid) {
    await throwAfterRollback(
      new Error("MITM server process failed to spawn"),
      { launchedProcess, nonce: instanceNonce, sudoPassword },
    );
  }

  const launcherPid = launchedProcess.pid;
  const launcherStart = getProcessStartIdentity(launcherPid);
  if (!launcherStart) {
    await throwAfterRollback(
      new Error("MITM launcher process identity could not be established safely"),
      { launchedProcess, launcherPid, nonce: instanceNonce, sudoPassword },
    );
  }
  const startingRecord = {
    pid: launcherPid,
    launcherPid,
    nonce: instanceNonce,
    state: "starting",
    launcherStart,
    processStart: launcherStart,
  };
  serverPid = launcherPid;
  serverLauncherPid = launcherPid;
  serverInstanceNonce = instanceNonce;
  serverLauncherStart = launcherStart;
  serverProcessStart = launcherStart;
  try {
    writeInitialPidRecord(startingRecord);
    publishLaunchAuthorization(serverLaunchGatePath, instanceNonce);
  } catch (error) {
    await throwAfterRollback(error, { launchedProcess, launcherPid, nonce: instanceNonce, sudoPassword });
  }
  mitmLastStartTime = Date.now();

  if (serverProcess) {
    launchedProcess.stdout?.on("data", (data) => {
      // server.js already formats its own logs — print as-is
      process.stdout.write(data);
    });
    launchedProcess.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      // Mac/Linux: filter sudo password prompt noise
      if (msg && (IS_WIN || (!msg.includes("Password:") && !msg.includes("password for")))) {
        err(msg);
        startError = msg;
      }
      // Detect wrong/missing password — clear cache and stop retry loop
      if (!IS_WIN && (msg.includes("incorrect password") || msg.includes("no password was provided"))) {
        setCachedPassword(null);
        void clearEncryptedPassword().catch((error) => {
          err(`[MITM] Legacy sudo credential purge failed: ${error.message}`);
        });
        mitmIsRestarting = true; // prevent scheduleMitmRestart from firing
      }
    });
    launchedProcess.on("exit", (code) => {
      if (!startupComplete) {
        exitedDuringStartup = true;
        startError ||= `Server exited during startup (code: ${code})`;
        return;
      }
      if (serverProcess !== launchedProcess || serverInstanceNonce !== instanceNonce) return;
      log(`Server exited (code: ${code})`);
      serverProcess = null;
      serverPid = null;
      serverLauncherPid = null;
      serverInstanceNonce = null;
      serverLauncherStart = null;
      serverProcessStart = null;
      if (!mitmIsRestarting) {
        // Every unrequested exit, including code 0, is unexpected. Keep the
        // durable PID/redirect journals and use the bounded restart policy;
        // terminal exhaustion performs verified cleanup and disables state.
        void scheduleMitmRestart(apiKey);
      }
    });
  }

  const health = await pollMitmHealth(8000, MITM_INTERNAL_PORT, instanceNonce);
  const authenticatedProcessStart = Number.isSafeInteger(health?.pid) && health.pid > 0
    ? await bindAuthenticatedProcessIdentity(health.pid, instanceNonce, MITM_INTERNAL_PORT)
    : null;
  const publicHealth = health
    ? await pollMitmHealth(3000, MITM_PORT, instanceNonce)
    : null;
  const launchEnded = exitedDuringStartup
    || launchedProcess.exitCode != null
    || launchedProcess.signalCode != null;
  if (!health
    || spawnFailure
    || launchEnded
    || publicHealth?.pid !== health?.pid
    || serverProcess !== launchedProcess
    || !Number.isSafeInteger(health.pid)
    || health.pid <= 0
    || !authenticatedProcessStart) {
    const processUsing443 = getProcessUsingPort443();
    const portInfo = processUsing443 ? ` Port 443 already in use by ${processUsing443}.` : "";
    const reason = startError || `Check the local ${MITM_PORT}→${MITM_INTERNAL_PORT} redirect/isolation and port access.${portInfo}`;
    await throwAfterRollback(
      new Error(`MITM server failed to start. ${reason}`),
      {
        launchedProcess,
        launcherPid,
        actualPid: health?.pid || null,
        nonce: instanceNonce,
        sudoPassword,
        launcherStart,
        actualStart: authenticatedProcessStart
          || (health?.pid === launcherPid ? launcherStart : null),
      },
    );
  }

  const runningRecord = {
    pid: health.pid,
    launcherPid,
    nonce: instanceNonce,
    state: "running",
    launcherStart,
    processStart: null,
  };
  runningRecord.processStart = authenticatedProcessStart;
  try {
    if (!replacePidFileIfMatches(startingRecord, runningRecord)) {
      throw new Error("MITM server health PID could not be recorded safely");
    }
  } catch (error) {
    await throwAfterRollback(error, {
      launchedProcess,
      launcherPid,
      actualPid: health.pid,
      nonce: instanceNonce,
      sudoPassword,
      launcherStart,
      actualStart: authenticatedProcessStart,
    });
  }
  serverPid = health.pid;
  serverLauncherPid = launcherPid;
  serverInstanceNonce = instanceNonce;
  serverLauncherStart = launcherStart;
  serverProcessStart = authenticatedProcessStart;
  try {
    const launchSnapshot = readFileSnapshot(serverLaunchGatePath);
    if (launchSnapshot.raw !== `${instanceNonce}\n`
      || !removeFileIfUnchanged(serverLaunchGatePath, launchSnapshot)) {
      throw new Error("MITM launch authorization was not consumed safely");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      await throwAfterRollback(error, {
        launchedProcess,
        launcherPid,
        actualPid: health.pid,
        nonce: instanceNonce,
        sudoPassword,
        redirectOwned: true,
      });
    }
  }
  serverLaunchGatePath = null;
  startupComplete = true;

  if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });

  log(`✅ Server healthy (PID: ${serverPid || health.pid})`);

  // Log DNS status per tool
  const dnsStatus = checkAllDNSStatus();
  for (const [tool, active] of Object.entries(dnsStatus)) {
    log(`🌐 DNS ${tool}: ${active ? "✅ active" : "❌ inactive"}`);
  }

  try {
    await saveMitmSettings(true);
  } catch (error) {
    await throwAfterRollback(error, {
      launchedProcess,
      launcherPid,
      actualPid: health.pid,
      nonce: instanceNonce,
      sudoPassword,
      redirectOwned: true,
    });
  }
  if (sudoPassword) setCachedPassword(sudoPassword);

  return { running: true, pid: serverPid };
  });
}

/**
 * Stop MITM server — removes ALL tool DNS entries first, then kills server
 */
async function stopServer(sudoPassword, { preserveDesiredState = false } = {}) {
  // Prevent auto-restart from triggering on intentional stop
  mitmIsRestarting = true;
  mitmRestartCount = 0;
  try {
    return await startGate.runAfterIdle(async () => {
  log("⏹ Stopping server...");

  // Kill server process
  const proc = serverProcess;
  let record = null;
  let persistedSnapshot = null;
  try { ({ record, snapshot: persistedSnapshot } = readPidRecord()); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const persistedRecord = record;
  const localRecord = serverInstanceNonce && serverPid
    ? {
      version: 1,
      pid: serverPid,
      launcherPid: serverLauncherPid || serverPid,
      nonce: serverInstanceNonce,
      state: "running",
      launcherStart: serverLauncherStart,
      processStart: serverProcessStart,
    }
    : null;
  let candidate = localRecord || record;
  let verified = false;
  let targetPid = candidate?.pid || null;
  let targetStart = candidate?.processStart
    || (candidate?.pid === candidate?.launcherPid ? candidate?.launcherStart : null);
  let forceOwnedLauncher = false;
  const locallyOwnedLauncher = Boolean(
    localRecord
    && proc?.pid === localRecord.launcherPid
    && getProcessStartIdentity(localRecord.launcherPid) === localRecord.launcherStart,
  );

  const candidateHasLiveProcess = candidate
    && (isProcessAlive(candidate.pid) || isProcessAlive(candidate.launcherPid));
  if (candidate && (candidate.state !== "starting" ? isProcessAlive(candidate.pid) : candidateHasLiveProcess)) {
    if (candidate.version === 0) {
      const error = new Error("Live legacy PID metadata cannot authenticate process ownership safely");
      error.code = "MITM_OWNERSHIP_UNVERIFIED";
      throw error;
    }
    const healthPort = candidate.version === 0 ? MITM_PORT : MITM_INTERNAL_PORT;
    const health = await pollMitmHealth(1500, healthPort, candidate.nonce || null);
    const healthPid = Number.isSafeInteger(health?.pid) && health.pid > 0 ? health.pid : null;
    verified = candidate.state === "starting"
      ? healthPid != null
      : healthPid === candidate.pid;
    if (verified && candidate.state === "starting") {
      targetPid = healthPid;
      if (healthPid !== candidate.pid) targetStart = null;
    }
    if (verified && !targetStart) {
      targetStart = await bindAuthenticatedProcessIdentity(targetPid, candidate.nonce, healthPort);
      if (!targetStart) verified = false;
    }
    if (!verified) log(`[MITM] Refusing to stop unverified PID ${candidate.pid}`);
  } else if (candidate) {
    // A dead running, starting, or legacy PID is stale metadata, not an owned
    // process to kill. Privileged current-user state is still cleaned below.
    verified = true;
    targetPid = null;
  }

  if (!verified && locallyOwnedLauncher) {
    verified = true;
    targetPid = localRecord.launcherPid;
    targetStart = localRecord.launcherStart;
    forceOwnedLauncher = true;
  }
  if (candidate && !verified) {
    const error = new Error("MITM process ownership could not be verified; server metadata was preserved");
    error.code = "MITM_OWNERSHIP_UNVERIFIED";
    throw error;
  }

  const hasAuthenticatedLiveOwnership = Boolean(candidate?.version === 1 && verified && targetPid);
  const hasCleanupEvidence = Boolean(
    persistedSnapshot
    || serverRedirectOwned
    || fs.existsSync(REDIRECT_JOURNAL_FILE)
    || Object.values(checkAllDNSStatus()).some(Boolean)
  );
  if (!hasAuthenticatedLiveOwnership && hasCleanupEvidence) {
    const incumbentStatus = await checkLoopbackPortFree(IS_WIN ? MITM_PORT : MITM_INTERNAL_PORT);
    if (incumbentStatus !== "free") {
      const error = new Error("A live MITM transport exists without locally authenticated PID ownership; refusing cross-DATA_DIR cleanup");
      error.code = "MITM_OWNERSHIP_UNVERIFIED";
      throw error;
    }
  }

  // Disable durable desired state before privileged cleanup. If this write
  // fails, leave the process, hosts, redirect, and metadata untouched so the
  // caller can retry without a surprise auto-start on the next launch.
  if (!preserveDesiredState) await saveMitmSettings(false);

  // Restore global name resolution before taking the proxy away. If hosts
  // cleanup is denied or cancelled, leave the verified process and all
  // ownership metadata intact so the operator can retry safely.
  await removeAllDNSEntries(sudoPassword || getCachedPassword());

  if (verified && targetPid && isProcessAlive(targetPid)) {
    if (!targetStart) throw new Error(`Missing authenticated process-start identity for MITM PID ${targetPid}`);
    log(`Killing server (PID: ${targetPid})...`);
    if (forceOwnedLauncher) {
      await killProcess(targetPid, true, sudoPassword, targetStart);
    } else {
      await killProcess(targetPid, false, sudoPassword, targetStart);
      await new Promise(r => setTimeout(r, 1000));
      if (isProcessAlive(targetPid)) await killProcess(targetPid, true, sudoPassword, targetStart);
    }
  }
  if (verified
    && candidate?.launcherPid
    && candidate.launcherPid !== targetPid
    && isProcessAlive(candidate.launcherPid)
    && getProcessStartIdentity(candidate.launcherPid) === candidate.launcherStart) {
    await killProcess(candidate.launcherPid, true, sudoPassword, candidate.launcherStart);
  }
  const cleanupRecord = persistedRecord || localRecord;
  const ownsRedirect = serverRedirectOwned
    || cleanupRecord?.version === 1
    || Boolean(persistedSnapshot && !persistedRecord)
    || fs.existsSync(REDIRECT_JOURNAL_FILE);
  if (ownsRedirect) await removePortRedirect(sudoPassword || getCachedPassword());
  if (persistedSnapshot) {
    const removed = persistedRecord
      ? removePidFileIfMatches(persistedRecord)
      : removeFileIfUnchanged(PID_FILE, persistedSnapshot);
    if (!removed) throw new Error("MITM PID metadata changed during stop cleanup");
  }
  serverProcess = null;
  serverPid = null;
  serverLauncherPid = null;
  serverInstanceNonce = null;
  serverLauncherStart = null;
  serverProcessStart = null;
  serverRedirectOwned = false;
  setCachedPassword(null);

  return { running: false, pid: null };
    });
  } finally {
    mitmIsRestarting = false;
  }
}

/**
 * Enable DNS for a specific tool (requires server running)
 */
async function enableToolDNS(tool, sudoPassword) {
  return startGate.runAfterIdle(async () => {
    const status = await getMitmStatus();
    if (!status.running) throw new Error("MITM server is not running. Start the server first.");
    const password = await getInMemoryPassword(sudoPassword);
    await addDNSEntry(tool, password);
    try {
      await saveDnsToolState(tool, true);
    } catch (error) {
      try { await removeDNSEntry(tool, password); } catch (rollbackError) { error.rollbackError = rollbackError; }
      throw error;
    }
    return { success: true };
  });
}

/**
 * Disable DNS for a specific tool
 */
async function disableToolDNS(tool, sudoPassword) {
  return startGate.runAfterIdle(async () => {
    const password = await getInMemoryPassword(sudoPassword);
    await removeDNSEntry(tool, password);
    try {
      await saveDnsToolState(tool, false);
    } catch (error) {
      try { await addDNSEntry(tool, password); } catch (rollbackError) { error.rollbackError = rollbackError; }
      throw error;
    }
    return { success: true };
  });
}

/**
 * Install Root CA to system trust store (standalone, no server start)
 */
async function trustCert(sudoPassword) {
  return startGate.runAfterIdle(() => withRootCALock(async () => {
    const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
    if (!fs.existsSync(rootCACertPath)) throw new Error("Root CA not found. Start server first to generate it.");
    const { installCert } = require("./cert/install");
    const password = await getInMemoryPassword(sudoPassword);
    if (!IS_WIN && !IS_MAC && !isSudoAvailable()) {
      await installCert(null, rootCACertPath);
      const { checkCertInstalled } = require("./cert/install");
      if (!await checkCertInstalled(rootCACertPath)) {
        log(`🔐 Cert: system trust unavailable and no verifiable NSS database exists. Use file: ${rootCACertPath}`);
      }
      return;
    }
    if (!password && isSudoPasswordRequired()) throw new Error("Sudo password required to trust certificate");
    await installCert(password, rootCACertPath);
    if (password) setCachedPassword(password);
  }));
}

// Legacy aliases for backward compatibility
const startMitm = startServer;
const stopMitm = stopServer;

module.exports = {
  getMitmStatus,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  trustCert,
  // Legacy
  startMitm,
  stopMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  clearEncryptedPassword,
  isSudoPasswordRequired,
  initDbHooks,
  restoreToolDNS,
  hasDnsPrivilege,
  hasMitmCleanupState,
  isAdmin,
  removeAllDNSEntriesSync,
};
