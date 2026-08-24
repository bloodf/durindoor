/**
 * OpenCode Go usage support from upstream #3250.
 *
 * `percent` is percent used. A spent plan may answer chat with the same HTTP
 * status as invalid authentication, but identifies itself structurally as a
 * `CreditsError`. This endpoint exists only for the paid Go provider; keyless
 * `opencode` remains separate.
 */

import { U, fetchWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";
import { isObject, isString } from "@/shared/utils/typeChecks.js";

const USAGE = U("opencode-go");
export const OPENCODE_GO_USAGE_URL = USAGE.url;

const WINDOW_LABELS = {
  rolling: "Rolling",
  weekly: "Weekly",
  monthly: "Monthly"
};

/** Map Go's percent-used windows to the dashboard quota contract. */
export function parseOpenCodeGoUsage(payload) {
  const windows = payload?.usage;
  if (!windows || !isObject(windows) || Array.isArray(windows)) return null;

  const quotas = {};
  let limitReached = false;
  for (const [key, label] of Object.entries(WINDOW_LABELS)) {
    const window = windows[key];
    if (!window || !isObject(window) || Array.isArray(window)) continue;

    const rawPercent = toFiniteNumber(window.percent, NaN);
    const status = isString(window.status) ?
    window.status.trim().toLowerCase().replaceAll("_", "-") :
    "";
    const blocked = status === "rate-limited" || Number.isFinite(rawPercent) && rawPercent >= 100;
    const used = Number.isFinite(rawPercent) ?
    Math.max(0, Math.min(100, Math.round(rawPercent))) :
    blocked ? 100 : 0;
    limitReached ||= blocked;
    quotas[label] = {
      used,
      total: 100,
      remainingPercentage: 100 - used,
      resetAt: blocked || used > 0 ? parseResetTime(window.resetsAt) : null,
      unlimited: false
    };
  }

  return Object.keys(quotas).length ? { quotas, limitReached } : null;
}

/** Distinguish a valid-but-spent plan from invalid authentication. */
export function isOpenCodeGoCreditsError(bodyText) {
  try {
    return JSON.parse(bodyText)?.error?.type === "CreditsError";
  } catch {
    return false;
  }
}

/** Keep authentication failure distinct from spent plans and transient upstream failure. */
export function classifyOpenCodeGoValidation(response, bodyText) {
  if (response.ok || isOpenCodeGoCreditsError(bodyText)) return { valid: true, error: null };
  if (response.status === 401 || response.status === 403) return { valid: false, error: "Invalid API key" };
  return { valid: false, error: "Provider unavailable - try again later" };
}

/** Fetch authenticated OpenCode Go quota windows. */
export async function getOpenCodeGoUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "OpenCode Go API key not available." };

  try {
    const response = await fetchWithTimeout(
      OPENCODE_GO_USAGE_URL,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
      10000,
      proxyOptions
    );
    if (response.status === 401 || response.status === 403) {
      return { message: "OpenCode Go API key invalid or expired." };
    }
    if (!response.ok) return { message: `OpenCode Go usage API error (${response.status}).` };

    const parsed = parseOpenCodeGoUsage(await response.json());
    if (!parsed) return { plan: "OpenCode Go", message: "OpenCode Go reported no usage windows.", quotas: {} };
    return { plan: "OpenCode Go", ...parsed };
  } catch (error) {
    return { message: `OpenCode Go usage fetch failed: ${error.message}` };
  }
}