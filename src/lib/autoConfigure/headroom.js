import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_HEADROOM_URL,
  findHeadroomBinary,
  findPython310,
  getHeadroomStatus,
  isLoopbackHeadroomUrl,
} from "../headroom/detect.js";
import { startHeadroomProxy } from "../headroom/process.js";

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";
const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PIP_TIMEOUT_MS = 60000;
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];

function logAction(report, dryRun, action) {
  report.actions.push(dryRun ? `would ${action}` : action);
}

function findUv() {
  try {
    const out = execSync(`${WHICH_CMD} uv`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

function findPipModule(python) {
  try {
    execFileSync(python, ["-m", "pip", "--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    return true;
  } catch {
    return false;
  }
}

function findPython310ForInstall() {
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const ver = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      }).toString().trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) continue;
      if (!findPipModule(candidate)) continue;
      return candidate;
    } catch {
      // candidate not present, try next
    }
  }
  return null;
}

export async function detectHeadroom({ url = DEFAULT_HEADROOM_URL } = {}) {
  const status = await getHeadroomStatus(url);
  return {
    installed: status.installed,
    running: status.running,
    python: status.python,
    path: status.path,
    url,
    localUrl: status.localUrl,
  };
}

export async function installHeadroom({ python, uv } = {}) {
  const uvBin = uv || findUv();
  if (uvBin) {
    try {
      execFileSync(uvBin, ["tool", "install", "headroom-ai[proxy]", "--force"], {
        stdio: "inherit",
        windowsHide: true,
        timeout: PIP_TIMEOUT_MS,
        env: { ...process.env, PATH: EXTENDED_PATH },
      });
      return { installed: Boolean(findHeadroomBinary()), method: "uv" };
    } catch (e) {
      return { installed: false, method: "uv", error: e.message || String(e) };
    }
  }
  const py = python || findPython310ForInstall();
  if (!py) {
    return { installed: false, method: "pip", error: "No Python >= 3.10 with pip found" };
  }
  try {
    execFileSync(py, ["-m", "pip", "install", "--upgrade", "headroom-ai[proxy]"], {
      stdio: "inherit",
      windowsHide: true,
      timeout: PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    return { installed: Boolean(findHeadroomBinary()), method: "pip" };
  } catch (e) {
    return { installed: false, method: "pip", error: e.message || String(e) };
  }
}

export async function configureHeadroom(settings, { dryRun = false, url, install = installHeadroom } = {}) {
  const report = { changed: false, actions: [] };

  // Prefer caller-provided URL, then the configured URL, then the default.
  // A reachable external endpoint is usable even without a local CLI.
  const effectiveUrl = url || settings.headroomUrl || DEFAULT_HEADROOM_URL;
  const detected = await detectHeadroom({ url: effectiveUrl });
  const uv = findUv();
  const installPython = findPython310ForInstall();
  const canInstall = Boolean(uv || installPython);

  let installed = detected.installed;
  let running = detected.running;
  let wouldStart = false;

  if (running) {
    report.actions.push(`headroom reachable at ${effectiveUrl}`);
  } else if (!installed && !dryRun) {
    const installResult = await install({ python: detected.python || installPython, uv });
    if (installResult.installed) {
      installed = true;
      report.actions.push(`installed headroom-ai[proxy] via ${installResult.method}`);
    } else {
      report.actions.push(`install skipped: ${installResult.error}`);
    }
  }

  if (!running) {
    if (installed && isLoopbackHeadroomUrl(effectiveUrl)) {
      if (dryRun) {
        report.actions.push(`would start headroom proxy on ${effectiveUrl}`);
        wouldStart = true;
      } else {
        try {
          const port = parseInt(new URL(effectiveUrl).port || "8787", 10);
          const startResult = await startHeadroomProxy({ port });
          report.actions.push(startResult.alreadyRunning ? `headroom proxy already running on ${effectiveUrl}` : `started headroom proxy on ${effectiveUrl}`);
          running = true;
        } catch (e) {
          report.actions.push(`headroom install succeeded but start failed: ${e.message || String(e)}`);
          return {
            changed: false,
            wouldChange: false,
            wouldInstall: false,
            installed: true,
            running: false,
            actions: report.actions,
            updates: {},
          };
        }
      }
    }

    if (!running && !wouldStart) {
      const wouldInstall = dryRun && !installed && canInstall;
      report.actions.push(wouldInstall ? "headroom not reachable; would install then enable" : "headroom not reachable and no install path found; skipping");
      return {
        changed: false,
        wouldChange: wouldInstall || false,
        wouldInstall: wouldInstall || false,
        installed: installed || false,
        running: false,
        actions: report.actions,
        updates: {},
      };
    }
  }

  if (!settings.headroomEnabled) {
    logAction(report, dryRun, "set headroomEnabled to true");
    report.changed = true;
  } else {
    report.actions.push("headroomEnabled already true");
  }

  const targetUrl = effectiveUrl;
  if (settings.headroomUrl !== targetUrl) {
    logAction(report, dryRun, `set headroomUrl to ${targetUrl}`);
    report.changed = true;
  } else {
    report.actions.push(`headroomUrl already ${targetUrl}`);
  }

  if (!settings.headroomCompressUserMessages) {
    logAction(report, dryRun, "set headroomCompressUserMessages to true");
    report.changed = true;
  } else {
    report.actions.push("headroomCompressUserMessages already true");
  }

  const updates = {};
  if (report.changed && !dryRun) {
    updates.headroomEnabled = true;
    updates.headroomUrl = targetUrl;
    updates.headroomCompressUserMessages = true;
  }

  return {
    changed: report.changed && !dryRun,
    wouldChange: report.changed,
    wouldInstall: false,
    installed: installed || false,
    running,
    localUrl: isLoopbackHeadroomUrl(targetUrl),
    actions: report.actions,
    updates,
  };
}

export { findUv, findPipModule, findHeadroomBinary, findPython310 };
