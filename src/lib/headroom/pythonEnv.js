import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { createDiagnostic, quoteShellArg, redactSensitive, SetupError } from "@/shared/utils/setupDiagnostics.js";

// headroom-ai declares `requires_python = ">=3.10"` with no upper bound.
import { isFunction } from "../../shared/utils/typeChecks.js";export const MIN_PYTHON = [3, 10];

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";
const EXTRA_BINS = IS_WIN ?
[
`${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
`${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
`${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
`${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
`${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`] :

[
"/usr/local/bin",
"/opt/homebrew/bin",
`${process.env.HOME || ""}/.local/bin`,
"/usr/bin",
"/bin"];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);

// How far past MIN_PYTHON to scan for a newer minor (e.g. 3.20) without a
// stale hardcoded version list that goes out of date every Python release.
// Nonexistent binaries fail the `which`/`where` lookup instantly, so a wide
// margin costs nothing.
const VERSION_LOOKAHEAD = 10;
const PROBE_TIMEOUT_MS = 5000;
const VENV_PROBE_TIMEOUT_MS = 15000;
const VENV_CREATE_TIMEOUT_MS = 30000;
// Interpreter discovery shells out per candidate, so a burst of dashboard
// status polls must not rescan. Short enough that installing a new Python is
// picked up without a restart.
const INTERPRETER_CACHE_TTL_MS = 60000;

const VERSION_PROBE_SCRIPT = `import sys, os, sysconfig, json
try:
    stdlib = sysconfig.get_path("stdlib")
    em = os.path.exists(os.path.join(stdlib, "EXTERNALLY-MANAGED"))
except Exception:
    em = False
print(json.dumps({"major": sys.version_info[0], "minor": sys.version_info[1], "em": em}))
`;

function candidateCommands() {
  const [major, minMinor] = MIN_PYTHON;
  const commands = [];
  for (let minor = minMinor + VERSION_LOOKAHEAD; minor >= minMinor; minor -= 1) {
    commands.push(`python${major}.${minor}`);
  }
  commands.push(`python${major}`, "python");
  return commands;
}

function resolveOnPath(command) {
  try {
    const out = execFileSync(WHICH_CMD, [command], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH }
    }).toString().trim();
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

function isUserScopedPath(resolvedPath) {
  if (IS_WIN) {
    const userProfile = process.env.USERPROFILE || "";
    return userProfile ? resolvedPath.toLowerCase().startsWith(userProfile.toLowerCase()) : false;
  }
  return /^\/(home|Users)\//.test(resolvedPath);
}

function versionAtLeast([major, minor], [minMajor, minMinor]) {
  return major > minMajor || major === minMajor && minor >= minMinor;
}

function describeExecError(error) {
  const stderr = error?.stderr ? Buffer.from(error.stderr).toString("utf8").trim() : "";
  const stdout = error?.stdout ? Buffer.from(error.stdout).toString("utf8").trim() : "";
  return stderr || stdout || error?.message || String(error);
}

function probeInterpreter(resolvedPath) {
  try {
    const out = execFileSync(resolvedPath, ["-c", VERSION_PROBE_SCRIPT], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH }
    }).toString();
    const parsed = JSON.parse(out);
    return { probe: { major: parsed.major, minor: parsed.minor, externallyManaged: Boolean(parsed.em) }, failed: false };
  } catch {
    return { probe: null, failed: true };
  }
}

// Real `python -m venv` into a throwaway temp dir, never `import venv`.
// Debian/Ubuntu split ensurepip into a separate `python3.X-venv` package, so
// `import venv` succeeds while creation still fails — only an actual create
// call surfaces that.
function probeCanCreateVenv(resolvedPath) {
  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-venv-probe-"));
  } catch (error) {
    return { ok: false, ensurepipMissing: false, stderr: describeExecError(error) };
  }
  try {
    execFileSync(resolvedPath, ["-m", "venv", tmpDir], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: VENV_PROBE_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH }
    });
    return { ok: true, ensurepipMissing: false, stderr: "" };
  } catch (error) {
    const stderr = describeExecError(error);
    return { ok: false, ensurepipMissing: /ensurepip/i.test(stderr), stderr };
  } finally {
    try {fs.rmSync(tmpDir, { recursive: true, force: true });} catch {/* best-effort cleanup */}
  }
}

// Full probe of every candidate interpreter. The `python -m venv` capability
// check is DEFERRED by default: creating a throwaway venv costs hundreds of
// milliseconds to seconds per candidate, and this runs behind
// `getHeadroomStatus()`, which the dashboard polls. Only the install path,
// which is about to create the real venv anyway, asks for it.
//
// Results are memoised for INTERPRETER_CACHE_TTL_MS so a burst of status polls
// costs one scan. A successful venv creation invalidates the cache.
let interpreterCache = { at: 0, withVenvProbe: false, entries: null };

function probeInterpretersDetailed({ probeVenv = false } = {}) {
  const fresh = Date.now() - interpreterCache.at < INTERPRETER_CACHE_TTL_MS;
  if (fresh && interpreterCache.entries && (interpreterCache.withVenvProbe || !probeVenv)) {
    return interpreterCache.entries;
  }
  const seen = new Set();
  const entries = [];
  let hadProbeError = false;
  for (const command of candidateCommands()) {
    const rawPath = resolveOnPath(command);
    if (!rawPath) continue;
    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(rawPath);
    } catch {
      resolvedPath = rawPath;
    }
    if (seen.has(resolvedPath)) continue;
    seen.add(resolvedPath);

    const userScoped = isUserScopedPath(resolvedPath);
    const result = probeInterpreter(resolvedPath);
    const probe = result.probe;
    hadProbeError ||= result.failed;
    if (!probe) {
      entries.push({
        command,
        resolvedPath,
        version: null,
        supported: false,
        userScoped,
        externallyManaged: false,
        venvProbe: { ok: false, probed: false, ensurepipMissing: false, stderr: "" }
      });
      continue;
    }
    const supported = versionAtLeast([probe.major, probe.minor], MIN_PYTHON);
    const canUseForVenv = supported && !(isRootProcess() && userScoped);
    const venvProbe = canUseForVenv && probeVenv ?
    { ...probeCanCreateVenv(resolvedPath), probed: true } :
    { ok: null, probed: false, ensurepipMissing: false, stderr: "" };
    entries.push({
      command,
      resolvedPath,
      version: `${probe.major}.${probe.minor}`,
      supported,
      userScoped,
      externallyManaged: probe.externallyManaged,
      venvProbe
    });
  }
  if (!hadProbeError) interpreterCache = { at: Date.now(), withVenvProbe: probeVenv, entries };
  return entries;
}

/** Drop the memoised interpreter scan (call after creating the managed venv). */
export function invalidateInterpreterCache() {
  interpreterCache = { at: 0, withVenvProbe: false, entries: null };
}

function fmtEntry(entry) {
  return `${entry.command} ${entry.version ?? "unknown"} (${entry.resolvedPath})`;
}

// Shared detail text for NO_SUPPORTED_PYTHON / PYTHON_USER_SCOPED_ONLY:
// names every interpreter this process actually found, split by why each
// one is or isn't usable by a (possibly root) service process.
function buildInterpreterDetail(entries, isRoot) {
  const rootVisible = entries.filter((e) => e.supported && !(isRoot && e.userScoped));
  const userScopedBlocked = isRoot ? entries.filter((e) => e.supported && e.userScoped) : [];
  const unsupported = entries.filter((e) => !e.supported);
  const parts = [];
  if (rootVisible.length) parts.push(`root-visible: ${rootVisible.map(fmtEntry).join(", ")}`);
  if (userScopedBlocked.length) {
    parts.push(`user-scoped, unusable by the service: ${userScopedBlocked.map(fmtEntry).join(", ")}`);
  }
  if (unsupported.length) {
    parts.push(`below Python ${MIN_PYTHON.join(".")}: ${unsupported.map(fmtEntry).join(", ")}`);
  }
  if (!parts.length) parts.push("no python interpreter found on PATH");
  return parts.join("; ");
}

function isRootProcess() {
  return isFunction(process.getuid) && process.getuid() === 0;
}

/**
 * Absolute directory of DurinDoor's managed Headroom virtual environment.
 *
 * Failure modes: none, this is a pure path computation.
 *
 * @returns {string}
 */
export function managedVenvDir() {
  return path.join(DATA_DIR, "headroom", "venv");
}

/**
 * Path to the managed venv's `python`, if the venv has actually been created.
 *
 * Failure modes: none; returns null when the venv or its interpreter is absent.
 *
 * @returns {string | null}
 */
export function managedVenvPython() {
  const bin = IS_WIN ?
  path.join(managedVenvDir(), "Scripts", "python.exe") :
  path.join(managedVenvDir(), "bin", "python");
  return fs.existsSync(bin) ? bin : null;
}

/**
 * Path to an installed console script inside the managed venv.
 *
 * Failure modes: none; returns null when the venv or the named binary is absent.
 *
 * @param {string} name Console-script name, e.g. "headroom".
 * @returns {string | null}
 */
export function managedVenvBinary(name) {
  const bin = IS_WIN ?
  path.join(managedVenvDir(), "Scripts", `${name}.exe`) :
  path.join(managedVenvDir(), "bin", name);
  return fs.existsSync(bin) ? bin : null;
}

/**
 * Enumerate every Python interpreter found on PATH from python3.<MIN+lookahead>
 * down to python3.<MIN_PYTHON minor>, plus `python3` and `python`, resolved
 * through symlinks (so uv/pyenv shims are unmasked) and de-duplicated by
 * real path.
 *
 * Failure modes: never throws. A candidate that fails to resolve or probe is
 * reported with `supported: false` rather than omitted. `canCreateVenv` is
 * `null` unless the caller asks for the expensive real-creation probe, because
 * that probe costs a subprocess per candidate and this runs behind polled
 * status endpoints.
 *
 * @param {{probeVenv?: boolean}} [options]
 * @returns {Array<{command: string, resolvedPath: string, version: string|null, supported: boolean, userScoped: boolean, externallyManaged: boolean, canCreateVenv: boolean|null}>}
 */
export function discoverInterpreters({ probeVenv = false } = {}) {
  return probeInterpretersDetailed({ probeVenv }).map(({ venvProbe, ...entry }) => ({
    ...entry,
    canCreateVenv: venvProbe.probed ? venvProbe.ok : null
  }));
}

/**
 * Pick the interpreter DurinDoor should use to create its managed venv.
 *
 * Never requires `headroom-ai` to already be importable — that gate is the
 * exact false-negative that made a demonstrably-installed Python report as
 * missing.
 *
 * Failure modes:
 * - `NO_SUPPORTED_PYTHON`: no interpreter >= MIN_PYTHON found at all.
 * - `PYTHON_USER_SCOPED_ONLY`: every supported interpreter resolves under a
 *   user home and this process runs as root (uid 0), so none is usable.
 * - `VENV_TOOLS_MISSING`: the best usable interpreter cannot create a venv
 *   because ensurepip is unavailable (Debian/Ubuntu split package).
 * - `VENV_CREATE_FAILED`: the best usable interpreter cannot create a venv
 *   for a reason unrelated to ensurepip.
 *
 * @returns {{command: string}}
 * @throws {SetupError}
 */
export function pickVenvBasePython() {
  // Only this path pays for real `python -m venv` probes: it is about to
  // create the venv for real, so a wrong answer here is expensive.
  const entries = probeInterpretersDetailed({ probeVenv: true });
  const supported = entries.filter((e) => e.supported);
  const root = isRootProcess();

  if (supported.length === 0) {
    throw new SetupError(createDiagnostic({
      code: "NO_SUPPORTED_PYTHON",
      summary: `No Python ${MIN_PYTHON.join(".")}+ interpreter found on PATH`,
      detail: buildInterpreterDetail(entries, root),
      fixes: [
      { label: "Install Python 3.10 or newer (Debian/Ubuntu)", command: "sudo apt install -y python3" },
      { label: "Or download an installer", url: "https://www.python.org/downloads/" }]

    }));
  }

  const usable = supported.filter((e) => !(root && e.userScoped));
  if (usable.length === 0) {
    throw new SetupError(createDiagnostic({
      code: "PYTHON_USER_SCOPED_ONLY",
      summary: `Only user-scoped Python ${MIN_PYTHON.join(".")}+ interpreters were found; the service runs as root and cannot use them`,
      detail: buildInterpreterDetail(entries, root),
      fixes: [
      { label: "Install a root-visible Python 3.10+ (Debian/Ubuntu)", command: "sudo apt install -y python3" },
      { label: "Or download an installer", url: "https://www.python.org/downloads/" }]

    }));
  }

  const withVenv = usable.find((e) => e.venvProbe.ok === true);
  if (!withVenv) {
    const candidate = usable[0];
    const minor = candidate.version.split(".")[1];
    if (candidate.venvProbe.ensurepipMissing) {
      throw new SetupError(createDiagnostic({
        code: "VENV_TOOLS_MISSING",
        summary: `${candidate.resolvedPath} cannot create a venv because ensurepip is unavailable`,
        detail: redactSensitive(`python -m venv failed for ${candidate.resolvedPath} (Python ${candidate.version}): ${candidate.venvProbe.stderr}`),
        fixes: [
        { label: `Install the venv/ensurepip package for Python ${candidate.version}`, command: `sudo apt install -y python3.${minor}-venv` }]

      }));
    }
    throw new SetupError(createDiagnostic({
      code: "VENV_CREATE_FAILED",
      summary: `${candidate.resolvedPath} failed to create a virtual environment`,
      detail: redactSensitive(`python -m venv failed for ${candidate.resolvedPath} (Python ${candidate.version}): ${candidate.venvProbe.stderr}`),
      fixes: [
      { label: "Retry venv creation manually and inspect the error", command: `${quoteShellArg(candidate.resolvedPath)} -m venv ${quoteShellArg("/tmp/durindoor-venv-check")}` }]

    }));
  }

  return { command: withVenv.resolvedPath };
}

/**
 * Create (if missing) DurinDoor's managed venv and return its interpreter.
 * Idempotent: returns the existing venv untouched when one already exists.
 *
 * Failure modes:
 * - Propagates every `pickVenvBasePython()` failure mode unchanged.
 * - `VENV_CREATE_FAILED`: the chosen interpreter passed the create-venv probe
 *   but the real `python -m venv` into the managed dir still failed (e.g.
 *   permissions, disk space), or produced a venv with no python binary.
 *
 * @returns {{python: string, binDir: string, created: boolean}}
 * @throws {SetupError}
 */
export function ensureManagedVenv() {
  const dir = managedVenvDir();
  const existingPython = managedVenvPython();
  if (existingPython) {
    let stat;
    let symlink = false;
    try {
      stat = fs.lstatSync(dir);
      symlink = stat.isSymbolicLink();
    } catch {/* fail closed below */}
    const expectedUid = isFunction(process.getuid) ? process.getuid() : null;
    const untrusted = !stat || symlink || expectedUid !== null && stat.uid !== expectedUid || (stat.mode & 0o022) !== 0;
    if (untrusted) {
      const observed = stat ? `symlink=${symlink}, uid=${stat.uid}, mode=${(stat.mode & 0o777).toString(8)}` : "directory metadata unavailable";
      throw new SetupError(createDiagnostic({
        code: "VENV_UNTRUSTED",
        summary: "Existing managed venv is owned by another user or is world-writable; refusing to run as root",
        detail: `Managed venv directory ${dir}: ${observed}. Expected uid ${expectedUid ?? "current user"} and no group/world write permissions.`,
        fixes: [
        { label: "Remove the untrusted venv and let DurinDoor recreate it", command: `rm -rf ${quoteShellArg(dir)}` },
        { label: "Or fix ownership manually", command: `chown -R $(id -u):$(id -g) ${quoteShellArg(dir)} && chmod 700 ${quoteShellArg(dir)}` }]

      }));
    }
    return { python: existingPython, binDir: path.dirname(existingPython), created: false };
  }

  const { command } = pickVenvBasePython();
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const existedBefore = fs.existsSync(dir);

  try {
    execFileSync(command, ["-m", "venv", dir], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: VENV_CREATE_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH }
    });
  } catch (error) {
    if (!existedBefore) {
      try {fs.rmSync(dir, { recursive: true, force: true });} catch {/* best-effort cleanup */}
    }
    const detail = redactSensitive(describeExecError(error));
    throw new SetupError(createDiagnostic({
      code: "VENV_CREATE_FAILED",
      summary: `Failed to create the managed virtual environment at ${dir}`,
      detail: `python -m venv ${dir} using ${command} failed: ${detail}`,
      fixes: [
      { label: "Retry venv creation manually and inspect the error", command: `${quoteShellArg(command)} -m venv ${quoteShellArg(dir)}` },
      { label: "Check permissions and free space for the data directory", command: `ls -ld ${quoteShellArg(path.dirname(dir))} && df -h ${quoteShellArg(path.dirname(dir))}` }],

      logTail: detail
    }));
  }

  const python = managedVenvPython();
  if (!python) {
    throw new SetupError(createDiagnostic({
      code: "VENV_CREATE_FAILED",
      summary: `Virtual environment created at ${dir} but no python binary was found inside it`,
      detail: `Expected ${IS_WIN ? "Scripts\\python.exe" : "bin/python"} under ${dir}`,
      fixes: [
      { label: "Remove the incomplete venv and retry", command: `rm -rf ${quoteShellArg(dir)}` }]

    }));
  }
  invalidateInterpreterCache();
  return { python, binDir: path.dirname(python), created: true };
}

function readShebangInterpreter(scriptPath) {
  let fd;
  try {
    if (!fs.statSync(scriptPath).isFile()) return null;
    fd = fs.openSync(scriptPath, "r");
    const limit = 4096;
    const buf = Buffer.alloc(limit);
    const bytesRead = fs.readSync(fd, buf, 0, limit, 0);
    const newline = buf.subarray(0, bytesRead).indexOf(0x0a);
    if (newline < 0 && bytesRead === limit) return null;
    const firstLine = buf.subarray(0, newline < 0 ? bytesRead : newline).toString("utf8");
    if (!firstLine.startsWith("#!")) return null;
    const interpreter = firstLine.slice(2).trim().split(/\s+/)[0] || null;
    return interpreter && interpreter.length <= 1024 ? interpreter : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {fs.closeSync(fd);} catch {/* already closed */}
    }
  }
}

/**
 * Describe a `headroom` binary found on PATH outside DurinDoor's managed
 * venv (e.g. a uv/pipx tool install), read-only. Never used for install or
 * repair — the managed venv is the only mutation target.
 *
 * Failure modes: never throws; returns null when no such external install
 * exists, including when the only `headroom` on PATH is the managed venv's
 * own binary.
 *
 * @returns {{path: string, interpreter: string|null, hasPip: boolean, userScoped: boolean} | null}
 */
export function describeExternalInstall() {
  const rawPath = resolveOnPath("headroom");
  if (!rawPath) return null;
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(rawPath);
  } catch {
    resolvedPath = rawPath;
  }

  const managed = managedVenvBinary("headroom");
  if (managed && path.resolve(resolvedPath) === path.resolve(managed)) return null;

  const interpreter = readShebangInterpreter(resolvedPath);
  const binDir = path.dirname(resolvedPath);
  const hasPip = ["pip", "pip3"].some((name) => fs.existsSync(path.join(binDir, name)));

  // Name the manager from the interpreter path rather than assuming uv: telling
  // a pipx user to run `uv tool uninstall` is worse than saying nothing, because
  // it fails and teaches them the guidance is unreliable.
  const probe = `${interpreter || ""} ${resolvedPath}`;
  const manager = /[/\\]uv[/\\]tools[/\\]/.test(probe) ?
  "uv" :
  /[/\\]pipx[/\\]/.test(probe) ?
  "pipx" :
  "unknown";
  const uninstallCommand = manager === "uv" ?
  "uv tool uninstall headroom-ai" :
  manager === "pipx" ?
  "pipx uninstall headroom-ai" :
  null;

  return {
    path: resolvedPath,
    interpreter,
    hasPip,
    userScoped: isUserScopedPath(resolvedPath),
    manager,
    uninstallCommand
  };
}