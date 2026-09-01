import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";

const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Classify Codex quota windows by a supplied finite duration before position.
 * Missing and invalid durations retain the caller's primary/secondary fallback.
 */
export function classifyCodexQuotaWindow(window, fallbackName) {
  const rawSeconds = window?.limit_window_seconds ?? window?.limitWindowSeconds;
  const windowSeconds = (isNumber(rawSeconds) || (isString(rawSeconds) && rawSeconds.trim())) &&
    Number.isFinite(Number(rawSeconds))
    ? Number(rawSeconds)
    : null;
  return {
    name: windowSeconds !== null && windowSeconds >= WEEKLY_WINDOW_SECONDS ? "weekly" : fallbackName,
    windowSeconds,
  };
}
