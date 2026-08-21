import { createDiagnostic, SetupError } from "@/shared/utils/setupDiagnostics.js";
import {
  DEFAULT_HEADROOM_URL,
  findHeadroomBinary,
  findPython310,
  getHeadroomStatus,
  isLoopbackHeadroomUrl,
} from "../headroom/detect.js";
import { describeExternalInstall } from "../headroom/pythonEnv.js";
import { installHeadroomExtras, startHeadroomProxy, stopHeadroomProxy } from "../headroom/process.js";

// Default compression extras requested by Auto-configure. `proxy` alone is
// never a complete install for this fork — `code` and `ml` must be
// requested too, or the reported headline bug (extras never installed)
// reproduces.
export const DEFAULT_HEADROOM_EXTRAS = ["proxy", "code", "ml"];

function logAction(report, dryRun, action) {
  report.actions.push(dryRun ? `would ${action}` : action);
}


const HEADROOM_HEALTH_ATTEMPTS = 5;
const HEADROOM_HEALTH_INTERVAL_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHeadroomHealth(url, attempts, wait) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await detectHeadroom({ url })).running) return true;
    if (attempt + 1 < attempts) await wait(HEADROOM_HEALTH_INTERVAL_MS);
  }
  return false;
}

// Nullable, CHEAP interpreter check — legacy callers depend on a
// `string | null` contract and must never see a thrown SetupError.
//
// This runs on every Auto-configure pass, including when Headroom is already
// installed and healthy, so it must not pay for real `python -m venv`
// capability probes; `findPython310()` answers from the managed venv or a
// version-only scan. The expensive probe belongs to `ensureManagedVenv()`,
// which runs only when a venv is actually being created. It also no longer
// requires the interpreter to have a pip module, which used to reject every
// valid root-visible interpreter on a fresh host.
function findPython310ForInstall() {
  return findPython310();
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

/**
 * Install Headroom into DurinDoor's managed virtual environment with the
 * requested compression extras. Replaces prior user-scoped installation,
 * which used a pip-less venv the root service could neither see nor repair
 * and which only ever requested `[proxy]`.
 *
 * @param {{python?: string, extras?: string[]}} [options] Installation options.
 *   `python` is accepted for backward compatibility but unused — the
 *   managed venv always supplies its own interpreter.
 * @returns {Promise<{installed: boolean, method?: string, diagnostic?: import("@/shared/utils/setupDiagnostics.js").SetupDiagnostic}>}
 */
export async function installHeadroom({ python, extras } = {}) {
  void python;
  try {
    // installHeadroomExtras() creates the managed venv itself; calling
    // ensureManagedVenv() here as well only duplicated the work.
    await installHeadroomExtras(extras ?? DEFAULT_HEADROOM_EXTRAS);
    return { installed: Boolean(findHeadroomBinary()), method: "managed venv" };
  } catch (error) {
    const diagnostic = error instanceof SetupError
      ? error.diagnostic
      : createDiagnostic({
        code: "INSTALL_FAILED",
        summary: "Headroom installation failed.",
        detail: error.message || String(error),
        fixes: [{
          label: "Review the Headroom install log",
          command: "tail -n 40 /opt/cortexos/.durindoor/headroom/install.log",
        }],
      });
    return { installed: false, diagnostic };
  }
}

/**
 * Detect, install, start, and persist settings for Headroom during
 * Auto-configure. Installation always goes through the managed venv
 * (`installHeadroom`); a detected user-scoped uv/pipx install is reported
 * read-only and never mutated.
 *
 * @param {object} settings Current persisted settings.
 * @param {object} [options] Auto-configuration options.
 */
export async function configureHeadroom(settings, {
  dryRun = false,
  url,
  install = installHeadroom,
  healthAttempts = HEADROOM_HEALTH_ATTEMPTS,
  sleep: wait = sleep,
} = {}) {
  const report = { changed: false, actions: [] };

  // Prefer caller-provided URL, then the configured URL, then the default.
  // A reachable external endpoint is usable even without a local CLI.
  let effectiveUrl = url || settings.headroomUrl || DEFAULT_HEADROOM_URL;
  let detected = await detectHeadroom({ url: effectiveUrl });
  const installPython = findPython310ForInstall();
  const canInstall = Boolean(installPython);

  const externalInstall = describeExternalInstall();
  if (externalInstall?.userScoped) {
    report.actions.push(`detected user-scoped Headroom install at ${externalInstall.path}; not used by the service, remove with: uv tool uninstall headroom-ai`);
  }

  let installed = detected.installed;
  let running = detected.running;
  let wouldStart = false;

  // A stale saved loopback URL may belong to another local service (for
  // example Hindsight on :8888). Auto-configure owns local recovery, so fall
  // back to Headroom's default port instead of repeatedly starting/probing the
  // unrelated service. An explicit caller URL and external URLs remain sacred.
  if (
    !running
    && !url
    && settings.headroomUrl
    && effectiveUrl !== DEFAULT_HEADROOM_URL
    && isLoopbackHeadroomUrl(effectiveUrl)
  ) {
    report.actions.push(`saved Headroom URL is unreachable; recovering to ${DEFAULT_HEADROOM_URL}`);
    effectiveUrl = DEFAULT_HEADROOM_URL;
    detected = await detectHeadroom({ url: effectiveUrl });
    installed ||= detected.installed;
    running = detected.running;
  }

  if (running) {
    report.actions.push(`headroom reachable at ${effectiveUrl}`);
  } else if (!installed && !dryRun) {
    const installResult = await install({ extras: DEFAULT_HEADROOM_EXTRAS });
    if (installResult.installed) {
      installed = true;
      report.actions.push(`installed headroom-ai[${DEFAULT_HEADROOM_EXTRAS.join(",")}] via ${installResult.method}`);
    } else {
      const diagnostic = installResult.diagnostic || createDiagnostic({
        code: "INSTALL_FAILED",
        summary: "Headroom installation failed.",
        detail: installResult.error || "The managed Headroom installation did not complete.",
        fixes: [{
          label: "Review the Headroom install log",
          command: "tail -n 40 /opt/cortexos/.durindoor/headroom/install.log",
        }],
      });
      report.actions.push(diagnostic.summary);
      const command = diagnostic.fixes[0]?.command;
      if (command) report.actions.push(command);
    }
  }

  if (!running) {
    if (installed && isLoopbackHeadroomUrl(effectiveUrl)) {
      if (dryRun) {
        report.actions.push(`would start headroom proxy on ${effectiveUrl}`);
        wouldStart = true;
      } else {
        let startResult;
        try {
          const port = parseInt(new URL(effectiveUrl).port || "8787", 10);
          startResult = await startHeadroomProxy({ port });
          report.actions.push(startResult.alreadyRunning ? `headroom proxy already running on ${effectiveUrl}` : `started headroom proxy on ${effectiveUrl}`);
        } catch (e) {
          report.actions.push(`headroom proxy start failed: ${e.message || String(e)}`);
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

        if (await waitForHeadroomHealth(effectiveUrl, healthAttempts, wait)) {
          running = true;
        } else {
          if (!startResult.alreadyRunning) {
            try { stopHeadroomProxy(); } catch { /* health failure remains primary */ }
          }
          report.actions.push("headroom health check failed after start; see proxy.log");
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

export { findHeadroomBinary, findPython310, findPython310ForInstall };
