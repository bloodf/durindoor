import { isString } from "@/shared/utils/typeChecks.js"; /**
 * Pure view helpers for rendering Headroom setup diagnostics in the dashboard.
 *
 * All user-facing string choices and branch decisions live here so the
 * presentational card can stay declarative.
 */

const CODE_HEADINGS = {
  NO_SUPPORTED_PYTHON: "No supported Python interpreter was found",
  PYTHON_USER_SCOPED_ONLY: "Python install is user-scoped under a root service",
  VENV_TOOLS_MISSING: "Managed virtualenv is missing required tools",
  VENV_CREATE_FAILED: "Could not create the managed virtualenv",
  INSTALL_FAILED: "Headroom install failed",
  INSTALL_TIMEOUT: "Headroom install timed out",
  PEP668: "Pip blocked the install (PEP 668)",
  EXTRA_WHEEL_UNAVAILABLE: "A Headroom extra has no compatible package wheel",
  NOT_INSTALLED: "Headroom is not installed",
  EARLY_EXIT: "Headroom proxy exited during startup",
  EXTERNAL_PROXY: "Headroom URL points outside loopback",
  STOP_FAILED: "Failed to stop the Headroom proxy",
  INTERNAL_ERROR: "Unexpected Headroom setup error"
};

const FALLBACK_HEADING = "Headroom setup needs attention";

export function headingForCode(code) {
  return CODE_HEADINGS[code] || FALLBACK_HEADING;
}

export function hasCopyableCommand(fix) {
  return isString(fix?.command) && fix.command.trim().length > 0;
}

export function hasLogTail(diagnostic) {
  return isString(diagnostic?.logTail) && diagnostic.logTail.trim().length > 0;
}

export function shouldShowExternalInstallNote(payload) {
  return Boolean(payload?.externalInstall);
}

export function sourceLabel(source) {
  if (source === "managed") return "Managed by DurinDoor";
  if (source === "path") return "From PATH (not managed)";
  return "Unknown source";
}

/**
 * Prose for a detected external install. The removal command is deliberately
 * NOT baked in: it depends on which tool manager produced the install, and
 * suggesting `uv` to a pipx user is worse than suggesting nothing.
 *
 * @param {{manager?: string}} [externalInstall]
 * @returns {string}
 */
export function externalInstallNote(externalInstall) {
  const manager = externalInstall?.manager;
  const named = manager && manager !== "unknown" ? ` (installed with ${manager})` : "";
  return `A user-scoped Headroom install was detected on PATH${named}. The service does not use it.`;
}

export function formatExtrasSummary(extras) {
  const code = !!extras?.code;
  const ml = !!extras?.ml;
  return `Compression extras: code ${code ? "present" : "absent"}, ml ${ml ? "present" : "absent"}.`;
}

export function diagnosticView(diagnostic) {
  if (!diagnostic) return null;
  return {
    heading: headingForCode(diagnostic.code),
    summary: diagnostic.summary,
    detail: diagnostic.detail,
    fixes: Array.isArray(diagnostic.fixes) ? diagnostic.fixes : []
  };
}

/**
 * Label for the single install action.
 *
 * On a host with nothing installed the panel used to offer only "Install
 * compression extras", which reads as an add-on to something absent — and the
 * status refresh returned early before that panel even rendered. Name the
 * action for the state the operator is actually in.
 *
 * @param {{installed?: boolean, extras?: Record<string, boolean>}} [state]
 * @returns {string}
 */
export function installActionLabel(state) {
  if (!state?.installed) return "Install Headroom with compression extras";
  const extras = state.extras || {};
  const missing = ["code", "ml"].filter((name) => !extras[name]);
  if (missing.length === 0) return "Reinstall compression extras";
  return `Install missing ${missing.join(" and ")} extra${missing.length > 1 ? "s" : ""}`;
}

/**
 * Decide what a status/report GET response means.
 *
 * A report endpoint is not an action endpoint: `GET /api/headroom/status`
 * answers 200 with a valid payload AND an informational diagnostic (typically
 * `NOT_INSTALLED`). Treating that as a transport failure zeroed the state, so an
 * installed and running proxy could read as "not installed" and the panel that
 * offers the repair was hidden. Only a non-OK response resets state.
 *
 * @param {boolean} ok HTTP ok flag.
 * @param {{diagnostic?: object}} [payload] Parsed body.
 * @returns {{applyPayload: boolean, resetState: boolean, diagnostic: object|null}}
 */
export function reportFetchOutcome(ok, payload) {
  const diagnostic = payload?.diagnostic ?? null;
  if (!ok) return { applyPayload: false, resetState: true, diagnostic };
  return { applyPayload: true, resetState: false, diagnostic };
}