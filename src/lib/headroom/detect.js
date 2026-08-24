import { execFileSync, execSync } from "child_process";
import path from "path";
import { createDiagnostic, SetupError } from "@/shared/utils/setupDiagnostics.js";
import { discoverInterpreters, managedVenvBinary, managedVenvDir, managedVenvPython, pickVenvBasePython } from "./pythonEnv.js";

// Extras that improve headroom compression quality. `proxy` is the base;
// `code` adds tree-sitter AST compression; `ml` adds Kompress-v2 HF model.
// Other `[all]` extras (image, voice, otel, reports, evals, ...) are not
// useful for the 9router proxy use case, so we don't track them here.
import { isFunction } from "../../shared/utils/typeChecks.js";export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"];

// Primary import-time marker module per extra (probed via importlib, works
// with no pip present) plus a secondary distribution-name marker (used both
// as a fallback signal and by the `pip list` fallback path below).
const EXTRA_MARKERS = {
  code: { module: "tree_sitter", dist: "tree-sitter-language-pack" },
  ml: { module: "torch", dist: "huggingface-hub" }
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
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
"/Library/Frameworks/Python.framework/Versions/3.13/bin",
"/Library/Frameworks/Python.framework/Versions/3.12/bin",
"/Library/Frameworks/Python.framework/Versions/3.11/bin",
"/Library/Frameworks/Python.framework/Versions/3.10/bin",
`${process.env.HOME || ""}/.local/bin`,
"/usr/bin",
"/bin"];


const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

function emptyExtras() {
  const extras = {};
  for (const extra of HEADROOM_COMPRESSION_EXTRAS) extras[extra] = false;
  return { installed: false, version: null, extras };
}

// Single `python -c` probe covering both the installed headroom-ai version
// and each extra's marker module, so it works even with NO pip present
// (uv-managed venvs have none). Built from EXTRA_MARKERS so a future extra
// only needs one entry, not a second hardcoded script.
function buildImportlibProbeScript() {
  const extraChecks = HEADROOM_COMPRESSION_EXTRAS.
  map((extra) => {
    const { module, dist } = EXTRA_MARKERS[extra];
    return `result["extras"]["${extra}"] = has_module("${module}") or has_dist("${dist}")`;
  }).
  join("\n");
  return `import importlib.metadata as m, importlib.util as u, json

def has_module(name):
    try:
        return u.find_spec(name) is not None
    except Exception:
        return False

def has_dist(name):
    try:
        m.version(name)
        return True
    except Exception:
        return False

result = {"version": None, "extras": {}}
try:
    result["version"] = m.version("headroom-ai")
except Exception:
    pass
${extraChecks}
print(json.dumps(result))
`;
}

const IMPORTLIB_PROBE_SCRIPT = buildImportlibProbeScript();

function probeExtrasViaImportlib(python) {
  try {
    const out = execFileSync(python, ["-c", IMPORTLIB_PROBE_SCRIPT], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH }
    }).toString();
    const parsed = JSON.parse(out);
    const version = parsed.version ?? null;
    return { installed: version !== null, version, extras: { ...emptyExtras().extras, ...parsed.extras } };
  } catch {
    return null;
  }
}

// Fallback for interpreters where the importlib probe itself fails to run
// (e.g. a broken venv). Requires pip, which a uv-managed venv may lack —
// hence this is a fallback, never the primary path.
function probeExtrasViaPip(python) {
  try {
    const out = execFileSync(python, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH }
    }).toString();
    const packages = JSON.parse(out);
    const names = new Set(packages.map((p) => String(p.name || "").toLowerCase()));
    if (!names.has("headroom-ai")) return emptyExtras();
    const version = packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    const extras = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      const { dist } = EXTRA_MARKERS[extra];
      extras[extra] = names.has(EXTRA_MARKERS[extra].module.replace(/_/g, "-")) || names.has(dist);
    }
    return { installed: true, version, extras };
  } catch {
    return emptyExtras();
  }
}

function resolveHeadroomOnPath() {
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH }
    }).toString().trim();
    // Windows `where` may return multiple lines — take the first.
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

// Managed venv first (DurinDoor's own install, safe to trust and reinstall
// into), PATH second (read-only external install, e.g. a uv/pipx tool venv).
function locateHeadroomBinary() {
  const managed = managedVenvBinary("headroom");
  if (managed) return { path: managed, source: "managed" };
  const onPath = resolveHeadroomOnPath();
  return { path: onPath, source: onPath ? "path" : null };
}

/**
 * Locate the headroom CLI: DurinDoor's managed venv first, PATH second.
 *
 * Failure modes: never throws; returns null when no binary is found anywhere.
 *
 * @returns {string | null}
 */
export function findHeadroomBinary() {
  return locateHeadroomBinary().path;
}

/**
 * Nullable alias over `pickVenvBasePython()` for legacy callers that expect
 * a plain string-or-null result and must never throw. Does NOT require
 * `headroom-ai` to already be importable on the chosen interpreter — that
 * gate previously reported a real Python install as "not found".
 *
 * Failure modes: never throws; returns null on any `SetupError` (no
 * supported Python, only user-scoped Python under a root service, or no
 * interpreter can create a venv). Callers needing the reason should call
 * `pickVenvBasePython()` directly and catch `SetupError`.
 *
 * @returns {string | null}
 */
export function findPython310() {
  // Cheap path only: this runs behind `getHeadroomStatus()`, which the
  // dashboard polls. The managed venv answers instantly when it exists, and
  // otherwise a version-only scan is enough — the expensive real
  // `python -m venv` capability probe belongs to the install path
  // (`pickVenvBasePython`/`ensureManagedVenv`), not to status.
  const managed = managedVenvPython();
  if (managed) return managed;
  const root = isFunction(process.getuid) && process.getuid() === 0;
  const usable = discoverInterpreters().find((entry) => entry.supported && !(root && entry.userScoped));
  return usable ? usable.resolvedPath : null;
}

/**
 * Probe whether a Headroom proxy is reachable at the given URL by hitting `/health`.
 *
 * Failure modes: never throws/rejects; returns false on any network error,
 * timeout, or non-OK response.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Whether a Headroom URL points at this host (safe for DurinDoor to manage
 * the process lifecycle of).
 *
 * Failure modes: never throws; returns false for an unparsable URL.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Parse installed headroom-ai version + which compression extras are
 * actually installed. Primary probe uses `importlib.metadata`/`importlib.util`
 * so it works with no pip present (uv-managed venvs have none); falls back
 * to `pip list --format=json` only if that probe itself fails to run.
 *
 * Failure modes: never throws; returns `{ installed: false, version: null,
 * extras: {code: false, ml: false} }` when no usable Python is available or
 * both probes fail.
 *
 * @param {string | null} [python] Interpreter path; resolved via `pickVenvBasePython()` if omitted.
 * @returns {{installed: boolean, version: string|null, extras: Record<string, boolean>}}
 */
export function getInstalledHeadroomExtras(python) {
  // Cheap resolution only — see findPython310. Never pay for venv-capability
  // probes just to report which extras are installed.
  const py = python || managedVenvPython() || findPython310();
  if (!py) return emptyExtras();
  return probeExtrasViaImportlib(py) ?? probeExtrasViaPip(py);
}

function buildNotInstalledDiagnostic(python) {
  return createDiagnostic({
    code: "NOT_INSTALLED",
    summary: "Headroom is not installed in the managed venv or on PATH",
    detail: python ?
    `No headroom binary found in the managed venv (${managedVenvDir()}) or on PATH; usable Python: ${python}` :
    `No headroom binary found in the managed venv (${managedVenvDir()}) or on PATH`,
    fixes: [
    { label: "Install headroom-ai with the proxy, code, and ml extras", command: "POST /api/headroom/extras" }]

  });
}

/**
 * Aggregate status for the dashboard: installed, running, python interpreter,
 * which extras are active, where the binary came from, and a structured
 * diagnostic describing any setup problem.
 *
 * Failure modes: never throws. Setup problems (no supported Python, Python
 * only user-scoped under a root service, headroom not installed) surface as
 * `diagnostic`, not as a rejected promise.
 *
 * @param {string} url
 * @returns {Promise<{installed: boolean, path: string|null, running: boolean, python: string|null, localUrl: boolean, canStart: boolean, version: string|null, extras: Record<string, boolean>, source: "managed"|"path"|null, diagnostic: import("@/shared/utils/setupDiagnostics.js").SetupDiagnostic|null}>}
 */
export async function getHeadroomStatus(url) {
  const { path: binaryPath, source } = locateHeadroomBinary();
  const installed = Boolean(binaryPath);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);

  let python = findPython310();
  let diagnostic = null;
  if (!python) {
    // Only now is the expensive picker worth running: it is the one call that
    // can explain WHY nothing is usable, and we are already in the failure case.
    try {
      python = pickVenvBasePython().command;
    } catch (error) {
      if (error instanceof SetupError) diagnostic = error.diagnostic;else
      throw error;
    }
  }

  const extrasStatus = installed ? getInstalledHeadroomExtras(python) : emptyExtras();
  if (!diagnostic && !installed) diagnostic = buildNotInstalledDiagnostic(python);

  return {
    installed,
    path: binaryPath,
    running,
    python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
    source: installed ? source : null,
    diagnostic
  };
}