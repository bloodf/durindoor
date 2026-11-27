import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Classify Codex quota windows by a supplied finite duration before position.
 * Missing and invalid durations retain the caller's primary/secondary fallback.
 */
export function classifyCodexQuotaWindow(window, fallbackName) {
  const rawSeconds = window?.limit_window_seconds ?? window?.limitWindowSeconds ??
    window?.window_seconds ?? window?.windowSeconds;
  const windowSeconds = (isNumber(rawSeconds) || (isString(rawSeconds) && rawSeconds.trim())) &&
    Number.isFinite(Number(rawSeconds))
    ? Number(rawSeconds)
    : null;
  return {
    name: windowSeconds !== null && windowSeconds >= WEEKLY_WINDOW_SECONDS ? "weekly" : fallbackName,
    windowSeconds,
  };
}

/** CLIProxyAPI codex_executor_terminal.go at dbe641f: billing belongs to the credential. */
export function codexBillingQuotaCode(payload) {
  if (!payload || !isObject(payload) || Array.isArray(payload)) return null;
  for (const error of [payload.error, payload, payload.body?.error, payload.response?.error]) {
    if (!error || !isObject(error) || Array.isArray(error)) continue;
    const code = isString(error.code) ? error.code.trim().toLowerCase() : "";
    const type = isString(error.type) ? error.type.trim().toLowerCase() : "";
    if (code === "insufficient_quota" || code === "credit_balance_exhausted") return code;
    if (type === "insufficient_quota") return type;
  }
  return null;
}
