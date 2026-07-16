import { UPDATER_CONFIG } from "@/shared/constants/config";

/**
 * Status helpers for the one-click updater (port of decolua/9router #2575).
 *
 * The detached updater process spawned by `spawnUpdaterAndExit` exposes a tiny
 * HTTP status endpoint that survives the Next server's exit; the dashboard
 * polls it until a terminal state. This module centralizes the endpoint URL,
 * phase labels, coarse progress mapping, and the terminal-state predicates,
 * plus the bounded-startup budget (upstream polls forever — see
 * `hasExceededStartupBudget`).
 */

/** Status endpoint exposed by the detached updater process (survives Next exit). */
export function getUpdaterStatusUrl(port = UPDATER_CONFIG.statusPort) {
  return `http://127.0.0.1:${port}/update/status`;
}

/**
 * Human-readable label for updater phase.
 * @param {string|null|undefined} phase
 * @param {{ attempt?: number, maxRetries?: number }} [meta]
 */
export function getUpdaterPhaseLabel(phase, meta = {}) {
  const attempt = meta.attempt || 0;
  const maxRetries = meta.maxRetries || UPDATER_CONFIG.installRetries;
  switch (phase) {
    case "starting":
      return "Starting updater…";
    case "waitingForExit":
      return "Stopping current app (releasing file locks)…";
    case "installing":
      return attempt > 0
        ? `Installing package (attempt ${attempt}/${maxRetries})…`
        : "Installing package…";
    case "done":
      return "Update complete — restarting app…";
    case "error":
      return "Update failed";
    default:
      return phase ? String(phase) : "Preparing…";
  }
}

/**
 * Coarse progress % for the overlay bar (not exact npm progress).
 * @param {{ phase?: string, attempt?: number, maxRetries?: number, done?: boolean, success?: boolean }} status
 */
export function getUpdaterProgressPercent(status) {
  if (!status || typeof status !== "object") return 5;
  const { phase, attempt = 0, maxRetries = UPDATER_CONFIG.installRetries, done, success } = status;
  if (done && success) return 100;
  if (phase === "error" || (done && !success)) return 90;
  switch (phase) {
    case "starting":
      return 8;
    case "waitingForExit":
      return 22;
    case "installing": {
      const safeMax = Math.max(1, maxRetries);
      const base = 35;
      const span = 50;
      const step = Math.min(attempt, safeMax) / safeMax;
      return Math.round(base + span * step);
    }
    case "done":
      return 100;
    default:
      return 5;
  }
}

/**
 * Whether auto-update finished successfully.
 * @param {object|null|undefined} status
 */
export function isUpdaterSuccess(status) {
  return !!(status && status.done && status.success);
}

/**
 * Whether auto-update finished with failure.
 * @param {object|null|undefined} status
 */
export function isUpdaterFailure(status) {
  return !!(status && (status.phase === "error" || (status.done && !status.success)));
}

/**
 * Bounded startup/poll budget in ms (durindoor addition: upstream polls
 * forever, which strands the overlay when the detached updater never comes
 * up). Covers process spawn + waitForExit + npm install with all retries.
 */
export function getUpdaterStartupBudgetMs(config = UPDATER_CONFIG) {
  return (
    30000 + // spawn + polling grace
    (config.waitForExitMaxMs || 0) +
    (config.installRetries || 0) * ((config.installRetryDelayMs || 0) + 90000)
  );
}

/**
 * Whether the updater has exceeded its startup/poll budget without reaching
 * a terminal state (status endpoint never appeared, or stuck mid-phase).
 * @param {number} startedAt epoch ms when auto-update was started
 * @param {number} now epoch ms
 * @param {{ budgetMs?: number }} [opts]
 */
export function hasExceededStartupBudget(startedAt, now, opts = {}) {
  if (typeof startedAt !== "number" || typeof now !== "number") return false;
  const budgetMs = typeof opts.budgetMs === "number" ? opts.budgetMs : getUpdaterStartupBudgetMs();
  return now - startedAt > budgetMs;
}
