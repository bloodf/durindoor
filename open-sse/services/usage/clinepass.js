/**
 * ClinePass usage — GET /api/v1/users/me/plan/usage-limits
 *
 * Auth:
 * - API key: Authorization: Bearer <apiKey>
 * - OAuth: buildClineHeaders(accessToken) → Bearer workos:<JWT>
 *
 * Response shape (verified against app.cline.bot dashboard):
 *   { success: true, data: { limits: [{ type, percentUsed, resetsAt }] } }
 *   type ∈ five_hour | weekly | monthly
 */

import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { buildClineHeaders } from "../../shared/clineAuth.js";
import { U, fetchWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";

const WINDOW_LABELS = {
  five_hour: "Session (5h)",
  weekly: "Weekly (7d)",
  monthly: "Monthly",
};

const WINDOW_ORDER = ["five_hour", "weekly", "monthly"];

function percentQuota(percentUsed, resetsAt) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(percentUsed, 0)));
  return {
    used,
    total: 100,
    remainingPercentage: Math.max(0, 100 - used),
    resetAt: parseResetTime(resetsAt),
  };
}

function buildAuthHeaders(accessToken, apiKey) {
  const useApiKey = isString(apiKey) && apiKey.trim().length > 0;
  if (useApiKey) {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    };
  }
  if (isString(accessToken) && accessToken.trim().length > 0) {
    return buildClineHeaders(accessToken.trim(), { Accept: "application/json" });
  }
  return null;
}

/**
 * @param {string|null|undefined} accessToken
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getClinepassUsage(accessToken = null, apiKey = null, proxyOptions = null) {
  const headers = buildAuthHeaders(accessToken, apiKey);
  if (!headers) {
    return { message: "ClinePass access token or API key not available." };
  }

  const usageUrl = U("clinepass").url;
  if (!usageUrl) {
    return { message: "ClinePass usage endpoint is not configured." };
  }

  try {
    const response = await fetchWithTimeout(
      usageUrl,
      { method: "GET", headers, redirect: "error" },
      10000,
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return {
        plan: "ClinePass",
        message: "ClinePass authentication expired. Please re-authorize.",
      };
    }

    if (!response.ok) {
      return {
        plan: "ClinePass",
        message: `ClinePass usage API error (${response.status})`,
      };
    }

    const body = await response.json().catch(() => null);
    if (!body || !isObject(body)) {
      return { message: "ClinePass usage response was not JSON." };
    }

    const limits = Array.isArray(body?.data?.limits) ? body.data.limits : [];
    const byType = new Map();
    for (const item of limits) {
      if (!item || !isObject(item)) continue;
      const type = isString(item.type) ? item.type : "";
      if (!WINDOW_LABELS[type]) continue;
      byType.set(type, item);
    }

    const quotas = {};
    for (const type of WINDOW_ORDER) {
      const item = byType.get(type);
      if (!item) continue;
      quotas[WINDOW_LABELS[type]] = percentQuota(item.percentUsed, item.resetsAt);
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan: "ClinePass",
        message: "ClinePass connected. No usage limits reported for this plan.",
        quotas: {},
      };
    }

    return { plan: "ClinePass", quotas };
  } catch {
    return { message: "ClinePass usage request failed." };
  }
}
