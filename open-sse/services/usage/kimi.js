/**
 * Kimi Coding usage — GET /v1/usages
 *
 * Dual auth (single provider id `kimi`):
 *   - apiKey present → x-api-key only (platform / coding API key)
 *   - else accessToken → Bearer + X-Msh-* (device-code OAuth; OmniRoute parity)
 *
 * Note: chat messages use combined x-api-key; /usages OAuth is Bearer.
 * 403 permission_denied is NOT auth-expired — account lacks usage feature / sub.
 */

import { parseResetTime, toFiniteNumber, fetchTextWithTimeout } from "./shared.js";
import { buildKimiHeaders } from "../../config/appConstants.js";
import { KIMI_CODING_USAGE_URL, KIMI_PLANS } from "../../providers/shared.js";
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

const QUOTA_PAGE = "https://www.kimi.com/membership/subscription?tab=quota";
const PRICING_PAGE = "https://www.kimi.com/membership/pricing?from=server_k3_error";

/** Map documented membership names while preserving unknown wire levels conservatively. */

function getKimiPlanName(level) {
  if (!level) return "";
  const key = String(level);
  if (KIMI_PLANS[key]) return KIMI_PLANS[key];
  return key.replace(/^LEVEL_/, "").toLowerCase();
}

/** Best-effort extract human message from Kimi error JSON (403 body is Connect-RPC-ish). */
export function formatKimiUsageError(status, responseText) {
  let parsed = null;
  try {
    parsed = JSON.parse(responseText || "");
  } catch {

    /* plain text */}

  const detail0 = Array.isArray(parsed?.details) ? parsed.details[0] : null;
  const debug = detail0?.debug || parsed?.debug || null;
  const reason = debug?.reason || parsed?.reason || "";
  const localized =
  debug?.localizedMessage?.message ||
  detail0?.localizedMessage?.message ||
  parsed?.message ||
  "";

  if (status === 401) {
    if (/subscription|access to|model id|context|highspeed/i.test(`${localized} ${responseText || ""}`)) {
      return `Kimi plan does not include this model or context limit. Upgrade or choose an available model: ${PRICING_PAGE}`;
    }
    return "Kimi authentication expired or the API key is invalid. Please re-authorize.";
  }

  // Live OAuth token without Kimi Code usage entitlement returns 403
  // REASON_FEATURE_NO_PERMISSION — not an expired session.
  if (
  status === 403 && (
  reason === "REASON_FEATURE_NO_PERMISSION" ||
  /permission_denied|do not have permission|subscribe/i.test(
    `${parsed?.code || ""} ${localized} ${responseText || ""}`
  )))
  {
    return (
      localized ||
      "Kimi connected, but this account has no permission to view usage. Subscribe to Kimi Code to access quota.");

  }

  if (status === 403) {
    return `Kimi quota is unavailable or exhausted. Check weekly, monthly, and rolling 5-hour quota: ${QUOTA_PAGE}`;
  }

  if (status === 429) {
    return "Kimi is temporarily overloaded or receiving too many concurrent requests. Wait briefly and retry.";
  }

  const snippet = (localized || responseText || "").slice(0, 100);
  return snippet ?
  `Kimi Coding connected. API Error ${status}: ${snippet}` :
  `Kimi Coding connected. API Error ${status}`;
}

function makeQuota({ used, total, remaining, resetAt }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  // Prefer provider remaining when present; never set absolute `remaining`
  // on the quota object — QuotaTable treats it as a 0–100 percentage.
  let remainingPct;
  if (safeTotal > 0 && remaining != null && Number.isFinite(Number(remaining))) {
    remainingPct = Math.max(0, Number(remaining)) / safeTotal * 100;
  } else if (safeTotal > 0) {
    remainingPct = Math.max(0, safeTotal - safeUsed) / safeTotal * 100;
  } else {
    remainingPct = 0;
  }
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage: remainingPct,
    resetAt: resetAt || null,
    unlimited: false
  };
}

/**
 * @param {string|null|undefined} accessToken
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 * @param {object|null} providerSpecificData
 */
export async function getKimiUsage(
accessToken = null,
apiKey = null,
proxyOptions = null,
providerSpecificData = null)
{
  const useApiKey = isString(apiKey) && apiKey.length > 0;
  const useOAuth = !useApiKey && isString(accessToken) && accessToken.length > 0;

  if (!useApiKey && !useOAuth) {
    return { message: "Kimi access token or API key not available." };
  }

  const authHeaders = useApiKey ?
  { "x-api-key": apiKey } :
  {
    Authorization: `Bearer ${accessToken}`,
    ...buildKimiHeaders(providerSpecificData?.deviceId)
  };

  try {
    const { response, text: responseText } = await fetchTextWithTimeout(
      KIMI_CODING_USAGE_URL,
      {
        method: "GET",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      },
      10000,
      proxyOptions
    );

    if (!response.ok) {
      return {
        plan: "Kimi Coding",
        message: formatKimiUsageError(response.status, responseText)
      };
    }

    let data;
    try {
      data = JSON.parse(responseText || "{}");
    } catch {
      return {
        plan: "Kimi Coding",
        message: "Kimi Coding connected. Invalid JSON response from API."
      };
    }

    const quotas = {};
    const usageObj = data?.usage && isObject(data.usage) ? data.usage : {};
    const usageLimit = toFiniteNumber(usageObj.limit ?? usageObj.Limit, 0);
    const usageUsed = toFiniteNumber(usageObj.used ?? usageObj.Used, 0);
    const usageRemainingRaw = usageObj.remaining ?? usageObj.Remaining;
    const usageRemaining =
    usageRemainingRaw != null && usageRemainingRaw !== "" ?
    toFiniteNumber(usageRemainingRaw, NaN) :
    NaN;
    const usageResetTime =
    usageObj.resetTime || usageObj.ResetTime || usageObj.reset_at || usageObj.resetAt;

    if (usageLimit > 0) {
      quotas.Weekly = makeQuota({
        used: usageUsed,
        total: usageLimit,
        remaining: Number.isFinite(usageRemaining) ? usageRemaining : null,
        resetAt: parseResetTime(usageResetTime)
      });
    }

    const limitsArray = Array.isArray(data?.limits) ? data.limits : [];
    for (const item of limitsArray) {
      if (!item || !isObject(item)) continue;
      const detail = item.detail && isObject(item.detail) ? item.detail : {};
      const limit = toFiniteNumber(detail.limit ?? detail.Limit, 0);
      const remaining = toFiniteNumber(detail.remaining ?? detail.Remaining, NaN);
      const resetTime = detail.resetTime || detail.reset_at || detail.resetAt;
      if (limit > 0) {
        const rem = Number.isFinite(remaining) ? remaining : Math.max(0, limit);
        quotas["Rolling 5-hour"] = makeQuota({
          used: Math.max(0, limit - rem),
          total: limit,
          remaining: rem,
          resetAt: parseResetTime(resetTime)
        });
      }
    }

    const membershipLevel = data?.user?.membership?.level;
    const planName = getKimiPlanName(membershipLevel) || "Kimi Coding";

    if (Object.keys(quotas).length > 0) {
      return { plan: planName, quotas };
    }

    return {
      plan: planName,
      message: "Kimi Coding connected. Usage tracked per request."
    };
  } catch (error) {
    return {
      message: `Kimi Coding connected. Unable to fetch usage: ${error.message}`
    };
  }
}