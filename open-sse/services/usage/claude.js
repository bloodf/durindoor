/**
 * Claude usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION, CLAUDE_CLI_SPOOF_HEADERS } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";
import { digestMemoryKey } from "../../utils/memoryKey.js";

// Claude API config (urls from registry, apiVersion is header logic kept here)
import { isNumber, isObject } from "../../../src/shared/utils/typeChecks.js";
const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  apiVersion: ANTHROPIC_API_VERSION
};

// Primary OAuth usage endpoint headers. Reuses the exported CLI fingerprint so
// the usage call matches chat identity and avoids unnecessary 429s. The shared
// fingerprint already contains Anthropic-Beta including oauth-2025-04-20.
function buildOAuthUsageHeaders(accessToken) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    ...CLAUDE_CLI_SPOOF_HEADERS
  };
}

// Bounded, token-keyed cache for last-successful OAuth quota responses. On
// transient failure, cached data keeps existing quota metadata available.
const OAUTH_QUOTA_CACHE_MAX = 100;
const OAUTH_QUOTA_CACHE_TTL_MS = 5 * 60 * 1000;
const OAUTH_RATE_LIMIT_COOLDOWN_MS = 180 * 1000;

const oauthQuotaCache = new Map();
const oauthQuotaInFlight = new Map();

function getOAuthCacheKey(accessToken) {
  return digestMemoryKey("claude-oauth-quota", accessToken);
}

function getOAuthCacheEntry(key) {
  const entry = oauthQuotaCache.get(key);
  if (!entry) return null;
  if (
  Date.now() - entry.cachedAt >= OAUTH_QUOTA_CACHE_TTL_MS &&
  Date.now() >= entry.rateLimitedUntil)
  {
    oauthQuotaCache.delete(key);
    return null;
  }
  if (
  !isOAuthRateLimited(entry) &&
  !entry.data?.quotas &&
  entry.rateLimitedUntil)
  {
    oauthQuotaCache.delete(key);
    return null;
  }
  return entry;
}

function setOAuthCacheEntry(key, data) {
  if (oauthQuotaCache.size >= OAUTH_QUOTA_CACHE_MAX) {
    const oldest = oauthQuotaCache.keys().next().value;
    oauthQuotaCache.delete(oldest);
  }
  oauthQuotaCache.set(key, { data, cachedAt: Date.now(), rateLimitedUntil: 0 });
}

function setOAuthRateLimited(key, data) {
  if (!oauthQuotaCache.has(key)) setOAuthCacheEntry(key, data);
  oauthQuotaCache.get(key).rateLimitedUntil = Date.now() + OAUTH_RATE_LIMIT_COOLDOWN_MS;
}

function isOAuthRateLimited(entry) {
  return Date.now() < entry.rateLimitedUntil;
}

function makeStaleResponse(entry, staleReason) {
  return { ...entry.data, stale: true, rateLimited: true, staleReason };
}

async function parseErrorBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function shouldFallbackToLegacy(status) {
  return status === 404 || status === 405;
}
/** Polls Claude OAuth quota once per credential at a time. */
export function getClaudeUsage(accessToken, proxyOptions = null, authType = "oauth", options = {}) {
  if (authType !== "oauth") {
    return getClaudeUsageLegacy(accessToken, proxyOptions);
  }

  const cacheKey = getOAuthCacheKey(accessToken);
  const cached = getOAuthCacheEntry(cacheKey);
  if (cached && isOAuthRateLimited(cached)) {
    return Promise.resolve(cached.data?.quotas ?
    makeStaleResponse(cached, "Rate limited; showing cached quota.") :
    cached.data);
  }
  if (!options.force && cached) return Promise.resolve(cached.data);

  const pending = oauthQuotaInFlight.get(cacheKey);
  if (pending) return pending;

  let request;
  request = pollClaudeOAuthUsage(accessToken, proxyOptions, cacheKey, cached).finally(() => {
    if (oauthQuotaInFlight.get(cacheKey) === request) oauthQuotaInFlight.delete(cacheKey);
  });
  oauthQuotaInFlight.set(cacheKey, request);
  return request;
}

async function pollClaudeOAuthUsage(accessToken, proxyOptions, cacheKey, cached) {
  try {
    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: buildOAuthUsageHeaders(accessToken)
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      // utilization = % USED (e.g. 87 means 87% used, 13% remaining)
      const hasUtilization = (window) =>
      window && isObject(window) && isNumber(window.utilization);

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

      // Parse model-specific weekly windows (e.g. seven_day_sonnet, seven_day_opus)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const modelName = key.replace("seven_day_", "");
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      const result = {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        quotas
      };
      setOAuthCacheEntry(cacheKey, result);
      return result;
    }

    const status = oauthResponse.status;
    const body = await parseErrorBody(oauthResponse);

    if (status === 429) {
      const result = cached?.data || { message: "Rate limited, try again later." };
      setOAuthRateLimited(cacheKey, result);
      return cached ?
      makeStaleResponse(cached, "Rate limited; showing cached quota.") :
      result;
    }

    if (status >= 500 && status < 600) {
      if (cached) {
        return { ...cached.data, stale: true, staleReason: "Claude usage temporarily unavailable; showing cached quota." };
      }
      return { message: "Claude usage temporarily unavailable. Try again later." };
    }

    if (shouldFallbackToLegacy(status)) {
      return await getClaudeUsageLegacy(accessToken, proxyOptions);
    }

    if (status === 401) {
      return { message: "Claude authentication expired (401). Re-authorize or refresh the connection." };
    }

    const message = body?.error?.message || body?.message || `OAuth endpoint returned ${status}`;
    return { message: `Claude connected. Unable to fetch usage: ${message}` };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

export function __clearOAuthQuotaCacheForTesting() {
  oauthQuotaCache.clear();
  oauthQuotaInFlight.clear();
}

/**
 * Legacy Claude usage for API key / org admin users
 */
async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion
      }
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion
            }
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access."
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}