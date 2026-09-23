/**
 * Claude usage handler.
 *
 * OAuth quota rows represent only windows reported by Anthropic. Model-scoped
 * weekly windows come from `limits[]`; absence never implies unused capacity.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { ANTHROPIC_API_VERSION, CLAUDE_CLI_SPOOF_HEADERS, CLAUDE_CLI_VERSION } from "../../providers/shared.js";
import { U, parseResetTime } from "./shared.js";
import { digestMemoryKey } from "../../utils/memoryKey.js";

// Claude API config (urls from registry, apiVersion is header logic kept here)
import { isNumber, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
const CLAUDE_CONFIG = {
  oauthUsageUrl: U("claude").oauthUrl,
  usageUrl: U("claude").orgUrl,
  settingsUrl: U("claude").settingsUrl,
  profileUrl: U("claude").profileUrl,
  resetUrl: U("claude").resetUrl,
  apiVersion: ANTHROPIC_API_VERSION
};

// Free "limit reset" grants (Anthropic program "cedar_ember") are only
// surfaced/consumable behind this exact UA; the sdk-cli fingerprint used for
// Messages/usage traffic elsewhere in this file does not qualify.
const CEDAR_EMBER_USER_AGENT = `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`;

// Primary OAuth usage endpoint headers. The shared fingerprint exactly mirrors
// Messages traffic; this separate OAuth endpoint retains its required beta flag.

// Plan shown when the connection carries no profile data — pre-profile logins,
// API keys, or a profile fetch that failed. Historical literal.
const DEFAULT_CLAUDE_PLAN = "Claude Code";

/**
 * Human plan name from the profile data captured at OAuth connect time.
 *
 * `rate_limit_tier` is the most specific signal (e.g. `default_claude_max_20x`);
 * `organization_type` and the account's `has_claude_*` flags are the fallbacks.
 * Returns the historical default when nothing is known, so a connection without
 * profile data reads exactly as it did before.
 *
 * @param {object|null} providerSpecificData - connection provider data
 * @returns {string} display plan name
 */
export function claudePlanName(providerSpecificData) {
  const tier = String(providerSpecificData?.claudeRateLimitTier || "").toLowerCase();
  const multiplier = tier.match(/_(\d+)x$/)?.[1];
  if (tier.includes("claude_max")) return multiplier ? `Claude Max ${multiplier}x` : "Claude Max";
  if (tier.includes("claude_pro")) return "Claude Pro";
  if (tier.includes("claude_team")) return "Claude Team";
  if (tier.includes("claude_enterprise")) return "Claude Enterprise";

  const orgType = String(providerSpecificData?.claudeOrgType || "").toLowerCase();
  if (orgType === "claude_max") return "Claude Max";
  if (orgType === "claude_pro") return "Claude Pro";
  if (orgType === "claude_team") return "Claude Team";
  if (orgType === "claude_enterprise") return "Claude Enterprise";

  if (providerSpecificData?.claudeHasMax) return "Claude Max";
  if (providerSpecificData?.claudeHasPro) return "Claude Pro";
  return DEFAULT_CLAUDE_PLAN;
}

function buildOAuthUsageHeaders(accessToken) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    ...CLAUDE_CLI_SPOOF_HEADERS,
    "Anthropic-Beta": `${CLAUDE_CLI_SPOOF_HEADERS["Anthropic-Beta"]},oauth-2025-04-20`,
    // cedar_ember grant eligibility is gated on this exact UA (see const above).
    "User-Agent": CEDAR_EMBER_USER_AGENT
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
// How long an entry is RETAINED for stale fallback after it stops being fresh.
// Must cover the longest rate-limit cooldown (2h) plus the serve-fresh window,
// otherwise the cache evaporates mid-cooldown and the dashboard blanks.
const OAUTH_QUOTA_RETENTION_MS = 3 * 60 * 60 * 1000;
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

/**
 * Cache entry usable as a FRESH response.
 *
 * Past the serve-fresh TTL the entry is kept, not dropped: it is still the
 * last-known-good quota and remains the only thing worth showing while a 429
 * cooldown blocks a refetch. `getOAuthFallbackEntry` reads those older rows.
 */
function getOAuthCacheEntry(key) {
  const entry = oauthQuotaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= OAUTH_QUOTA_CACHE_TTL_MS) return null;
  return entry;
}

/**
 * Cache entry usable as STALE fallback during a rate-limit cooldown.
 *
 * The cooldown escalates to 2h while the serve-fresh TTL is 30m, so an entry
 * that can no longer be served fresh is exactly the entry a rate-limited
 * dashboard still needs. Retention spans the longest cooldown so the card
 * keeps showing last-known values instead of blanking to
 * "Rate limited, try again later." for up to 90 minutes.
 */
function getOAuthFallbackEntry(key) {
  const entry = oauthQuotaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= OAUTH_QUOTA_RETENTION_MS) {
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
    // Fall back to the retained entry, not just the still-fresh one: the
    // cooldown (up to 2h) outlives the 30m serve-fresh TTL, so the rows the
    // user needs are usually older than "fresh".
    const fallback = getOAuthFallbackEntry(cacheKey);
    if (fallback?.data?.quotas) {
      return Promise.resolve(makeStaleResponse(fallback, "Rate limited; showing cached quota."));
    }
    return Promise.resolve(fallback?.data || { message: "Rate limited, try again later." });
  }
  if (!options.force && cached) return Promise.resolve(cached.data);

  const pending = oauthQuotaInFlight.get(cacheKey);
  if (pending) return pending;

  let request;
  request = pollClaudeOAuthUsage(accessToken, proxyOptions, cacheKey, claudePlanName(options?.providerSpecificData)).finally(() => {
    if (oauthQuotaInFlight.get(cacheKey) === request) oauthQuotaInFlight.delete(cacheKey);
  });
  oauthQuotaInFlight.set(cacheKey, request);
  return request;
}

async function pollClaudeOAuthUsage(accessToken, proxyOptions, cacheKey, plan = DEFAULT_CLAUDE_PLAN) {
  try {
    // cedar_ember=1 adds the "limit reset" grant block (same flag Claude Code sends)
    const oauthResponse = await proxyAwareFetch(`${CLAUDE_CONFIG.oauthUsageUrl}?cedar_ember=1`, {
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
        plan,
        extraUsage: data.extra_usage ?? null,
        resetCredits: parseClaudeResetGrants(data.cedar_ember),
        quotas
      };
      setOAuthCacheEntry(cacheKey, result);
      return result;
    }

    const status = oauthResponse.status;
    const body = await parseErrorBody(oauthResponse);

    if (status === 429) {
      recordOAuthRateLimit(cacheKey);
      // Prefer any retained entry: `cached` only covers the 30m serve-fresh
      // window, but a 429 arriving after that window still has usable rows.
      const fallback = getOAuthFallbackEntry(cacheKey);
      return fallback ?
      makeStaleResponse(fallback, "Rate limited; showing cached quota.") :
      { message: "Rate limited, try again later." };
    }

    if (status >= 500 && status < 600) {
      const fallback = getOAuthFallbackEntry(cacheKey);
      if (fallback) {
        return { ...fallback.data, stale: true, staleReason: "Claude usage temporarily unavailable; showing cached quota." };
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

// Free "limit reset" grants (Anthropic program id "cedar_ember").
// Shape: { eligible, next_grant_id, grants: [{ id, resets_left, ends_at, paused, clears }] }
export function parseClaudeResetGrants(block) {
  if (!block?.eligible || !Array.isArray(block.grants)) return null;
  const grants = block.grants.filter((g) => g?.id && !g.paused && Number(g.resets_left) > 0);
  const next = grants.find((g) => g.id === block.next_grant_id) || grants[0] || null;
  return {
    availableCount: grants.reduce((sum, g) => sum + Number(g.resets_left), 0),
    nextGrantId: next?.id || null,
    expiresAt: next?.ends_at || null,
    clears: next?.clears || [],
    cooldownUntil: block.cooldown_until || null,
    weeklyResetsAt: block.weekly_resets_at || null,
    grants: block.grants.filter((g) => g?.id).map((g) => ({
      id: g.id,
      label: g.label || "",
      resetsLeft: Number(g.resets_left) || 0,
      resetsTotal: Number(g.resets_total) || 0,
      startsAt: g.starts_at || null,
      endsAt: g.ends_at || null,
      clears: Array.isArray(g.clears) ? g.clears : [],
      paused: g.paused === true,
      usableNow: g.usable_now === true,
      useRequiresLimit: g.use_requires_limit !== false
    }))
  };
}

/**
 * Spend one free Claude Code "limit reset" grant. Refills the limits listed
 * in the grant's `clears`. Irreversible; callers must gate this behind an
 * explicit, confirmed user action — never call automatically.
 *
 * @param {string} accessToken - Claude OAuth access token
 * @param {string} grantId - id of the grant to redeem (from resetCredits.nextGrantId)
 * @param {object|null} proxyOptions
 * @returns {Promise<object>} { ok, status, result, reason, resetsLeft, message }
 */
export async function consumeClaudeResetGrant(accessToken, grantId, proxyOptions = null) {
  if (!accessToken) throw new Error("No Claude access token available. Please re-authorize the connection.");
  if (!/^[a-z0-9_-]{1,40}$/i.test(grantId || "")) throw new Error("Invalid reset grant id.");

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Anthropic-Beta": `${CLAUDE_CLI_SPOOF_HEADERS["Anthropic-Beta"]},oauth-2025-04-20`,
    "Anthropic-Version": CLAUDE_CONFIG.apiVersion,
    "User-Agent": CEDAR_EMBER_USER_AGENT,
    "Content-Type": "application/json"
  };

  const profileRes = await proxyAwareFetch(CLAUDE_CONFIG.profileUrl, { method: "GET", headers }, proxyOptions);
  const profile = await profileRes.json().catch(() => null);
  const orgId = profile?.organization?.uuid;
  if (!profileRes.ok || !orgId) throw new Error(`Cannot resolve Claude organization (${profileRes.status}).`);

  const res = await proxyAwareFetch(CLAUDE_CONFIG.resetUrl.replace("{org_id}", orgId), {
    method: "POST",
    headers,
    body: JSON.stringify({ program: "cedar_ember", grant_id: grantId, request_id: crypto.randomUUID() })
  }, proxyOptions);
  const data = await res.json().catch(() => null);

  // Force the next read past the cache: it must show the refilled limits.
  oauthQuotaCache.delete(getOAuthCacheKey(accessToken));

  return {
    ok: res.ok && data?.result === "reset",
    status: res.status,
    result: data?.result || null,
    reason: data?.reason || null,
    resetsLeft: data?.resets_left ?? null,
    message: data?.error?.message || null
  };
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