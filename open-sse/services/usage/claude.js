/**
 * Claude usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION, CLAUDE_CLI_SPOOF_HEADERS } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";
import { digestMemoryKey } from "../../utils/memoryKey.js";

// Claude API config (urls from registry, apiVersion is header logic kept here)
const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  apiVersion: ANTHROPIC_API_VERSION,
};

// Primary OAuth usage endpoint headers. Reuses the exported CLI fingerprint so
// the usage call matches chat identity and avoids unnecessary 429s. The shared
// fingerprint already contains Anthropic-Beta including oauth-2025-04-20.
function buildOAuthUsageHeaders(accessToken) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    ...CLAUDE_CLI_SPOOF_HEADERS,
  };
}

// Bounded, token-keyed cache for last-successful OAuth quota responses.
// On 429/transient 5xx from the OAuth usage endpoint we return stale cached
// data instead of falling back to the legacy org-admin API, which consumer
// OAuth tokens cannot access (that fallback produces the misleading
// "Usage API requires admin permissions" message).
const OAUTH_QUOTA_CACHE_MAX = 100;
const OAUTH_QUOTA_CACHE_TTL_MS = 5 * 60 * 1000;
const OAUTH_RATE_LIMIT_COOLDOWN_MS = 180 * 1000;

const oauthQuotaCache = new Map();

function getOAuthCacheKey(accessToken) {
  return digestMemoryKey("claude-oauth-quota", accessToken);
}

function getOAuthCacheEntry(key) {
  const entry = oauthQuotaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > OAUTH_QUOTA_CACHE_TTL_MS) {
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

function setOAuthRateLimited(key) {
  const entry = oauthQuotaCache.get(key);
  if (entry) {
    entry.rateLimitedUntil = Date.now() + OAUTH_RATE_LIMIT_COOLDOWN_MS;
  }
}

function isOAuthRateLimited(key) {
  const entry = oauthQuotaCache.get(key);
  return entry && Date.now() < entry.rateLimitedUntil;
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

// A response from the OAuth usage endpoint is only eligible for the legacy
// org-admin fallback when the token is clearly not a consumer OAuth token.
// Expired/invalid consumer OAuth tokens return 401/403 with messages that
// credential refresh handles; they must NOT fall back to the admin API.
const NON_CONSUMER_OAUTH_ERROR_TYPES = new Set([
  "unsupported_token_type",
  "invalid_token_type",
  "api_key_not_supported",
]);

const NON_CONSUMER_OAUTH_ERROR_MESSAGES = [
  /oauth token required/i,
  /api key.*not supported/i,
  /api keys?.*not supported/i,
  /this endpoint requires.*oauth/i,
];

function isNonConsumerOAuthTokenError(status, body) {
  if (status !== 401 && status !== 403) return false;
  const type =
    typeof body?.error?.type === "string"
      ? body.error.type
      : typeof body?.type === "string"
        ? body.type
        : "";
  if (NON_CONSUMER_OAUTH_ERROR_TYPES.has(type)) return true;
  const message =
    typeof body?.error?.message === "string"
      ? body.error.message
      : typeof body?.message === "string"
        ? body.message
        : "";
  return NON_CONSUMER_OAUTH_ERROR_MESSAGES.some((pattern) => pattern.test(message));
}

function shouldFallbackToLegacy(status, body) {
  return isNonConsumerOAuthTokenError(status, body);
}
export async function getClaudeUsage(accessToken, proxyOptions = null, authType = "oauth") {
  try {
    // For non-OAuth tokens (API keys, etc.) the OAuth endpoint is not applicable;
    // use the legacy org-admin path directly.
    if (authType !== "oauth") {
      return await getClaudeUsageLegacy(accessToken, proxyOptions);
    }

    const cacheKey = getOAuthCacheKey(accessToken);

    // While cooling down from a recent 429, serve cached data immediately.
    const cached = getOAuthCacheEntry(cacheKey);
    if (cached && isOAuthRateLimited(cacheKey)) {
      return makeStaleResponse(cached, "Rate limited; showing cached quota.");
    }

    // Primary: OAuth usage endpoint (Claude Code consumer OAuth tokens)
    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: buildOAuthUsageHeaders(accessToken),
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      // utilization = % USED (e.g. 87 means 87% used, 13% remaining)
      const hasUtilization = (window) =>
        window && typeof window === "object" && typeof window.utilization === "number";

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false,
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
        quotas,
      };
      setOAuthCacheEntry(cacheKey, result);
      return result;
    }

    const status = oauthResponse.status;
    const body = await parseErrorBody(oauthResponse);

    if (status === 429 || (status >= 500 && status < 600)) {
      if (cached) {
        if (status === 429) {
          setOAuthRateLimited(cacheKey);
          return makeStaleResponse(cached, "Rate limited; showing cached quota.");
        }
        return { ...cached.data, stale: true, staleReason: "Claude usage temporarily unavailable; showing cached quota." };
      }
      return {
        message:
          status === 429
            ? "Rate limited, try again later."
            : "Claude usage temporarily unavailable. Try again later.",
      };
    }

    if (shouldFallbackToLegacy(status, body)) {
      return await getClaudeUsageLegacy(accessToken, proxyOptions);
    }

    const message = body?.error?.message || body?.message || `OAuth endpoint returned ${status}`;
    return { message: `Claude connected. Unable to fetch usage: ${message}` };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

export function __clearOAuthQuotaCacheForTesting() {
  oauthQuotaCache.clear();
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
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
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
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage,
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access.",
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}
