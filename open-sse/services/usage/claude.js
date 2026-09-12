/**
 * Claude usage handler.
 *
 * OAuth quota rows represent only windows reported by Anthropic. Model-scoped
 * weekly windows come from `limits[]`; absence never implies unused capacity.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION, CLAUDE_CLI_SPOOF_HEADERS } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";
import { digestMemoryKey } from "../../utils/memoryKey.js";

// Claude API config (urls from registry, apiVersion is header logic kept here)
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  apiVersion: ANTHROPIC_API_VERSION
};

// Primary OAuth usage endpoint headers. The shared fingerprint exactly mirrors
// Messages traffic; this separate OAuth endpoint retains its required beta flag.
function buildOAuthUsageHeaders(accessToken) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    ...CLAUDE_CLI_SPOOF_HEADERS,
    "Anthropic-Beta": `${CLAUDE_CLI_SPOOF_HEADERS["Anthropic-Beta"]},oauth-2025-04-20`
  };
}

// Bounded, token-keyed cache for last-successful OAuth quota responses. On
// transient failure, cached data keeps existing quota metadata available.
// The quota windows move slowly (5h/7d resets) and Anthropic rate-limits this
// endpoint aggressively, so the TTL matches the dashboard's 30-minute Claude
// poll cadence — auto-refresh ticks normally read the cache instead of
// hitting upstream (port of the operator request to slow Claude polling).
const OAUTH_QUOTA_CACHE_MAX = 100;
const OAUTH_QUOTA_CACHE_TTL_MS = 30 * 60 * 1000;
// Rate-limit cooldown escalates per consecutive 429 (15m → 30m → 1h → 2h cap)
// so a tripped limit is not re-tripped every few minutes; a successful fetch
// resets the strike count.
const OAUTH_RATE_LIMIT_COOLDOWN_BASE_MS = 15 * 60 * 1000;
const OAUTH_RATE_LIMIT_COOLDOWN_MAX_MS = 2 * 60 * 60 * 1000;

const oauthQuotaCache = new Map();
const oauthQuotaInFlight = new Map();
// Rate-limit strikes live outside the cache: cache entries evaporate at the
// TTL boundary, but a 429 strike count must survive to keep escalating.
const oauthRateLimits = new Map();

function getOAuthCacheKey(accessToken) {
  return digestMemoryKey("claude-oauth-quota", accessToken);
}

function getOAuthCacheEntry(key) {
  const entry = oauthQuotaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= OAUTH_QUOTA_CACHE_TTL_MS) {
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
  // A successful fetch clears the rate-limit strike count.
  oauthRateLimits.delete(key);
  oauthQuotaCache.set(key, { data, cachedAt: Date.now() });
}

/** Active cooldown record for a key, or null when a retry is allowed. */
function getOAuthRateLimit(key) {
  const rateLimit = oauthRateLimits.get(key);
  if (!rateLimit) return null;
  if (Date.now() >= rateLimit.until) return null;
  return rateLimit;
}

function recordOAuthRateLimit(key) {
  if (oauthRateLimits.size >= OAUTH_QUOTA_CACHE_MAX && !oauthRateLimits.has(key)) {
    oauthRateLimits.delete(oauthRateLimits.keys().next().value);
  }
  const strikes = (oauthRateLimits.get(key)?.strikes || 0) + 1;
  const cooldown = Math.min(
    OAUTH_RATE_LIMIT_COOLDOWN_BASE_MS * 2 ** (strikes - 1),
    OAUTH_RATE_LIMIT_COOLDOWN_MAX_MS
  );
  oauthRateLimits.set(key, { strikes, until: Date.now() + cooldown });
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
  // The 429 cooldown is upstream protection: even a forced refresh honors it.
  if (getOAuthRateLimit(cacheKey)) {
    if (cached?.data?.quotas) {
      return Promise.resolve(makeStaleResponse(cached, "Rate limited; showing cached quota."));
    }
    return Promise.resolve(cached?.data || { message: "Rate limited, try again later." });
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

      // Retain provider-reported legacy model windows while Anthropic migrates
      // model-scoped weekly limits to limits[].
      const modelDisplayNames = {
        fable_5_1: "fable",
        fable_5: "fable"
      };

      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const rawName = key.replace("seven_day_", "");
          const modelName = modelDisplayNames[rawName] || rawName;
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      // Current model-scoped windows (including Fable) are reported as
      // { kind: "weekly_scoped", percent, resets_at, scope.model.display_name }.
      if (Array.isArray(data.limits)) {
        for (const limit of data.limits) {
          if (limit?.kind !== "weekly_scoped") continue;
          const displayName = limit?.scope?.model?.display_name;
          if (!isString(displayName) || !displayName.trim()) continue;
          if (!isNumber(limit.percent) || !Number.isFinite(limit.percent)) continue;
          const modelName = displayName.trim().toLowerCase();
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject({
            utilization: Math.max(0, Math.min(100, limit.percent)),
            resets_at: limit.resets_at
          });
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
      recordOAuthRateLimit(cacheKey);
      return cached ?
      makeStaleResponse(cached, "Rate limited; showing cached quota.") :
      { message: "Rate limited, try again later." };
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
  oauthRateLimits.clear();
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