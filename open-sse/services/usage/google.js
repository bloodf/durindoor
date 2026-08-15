/**
 * Google usage handlers (Gemini CLI + Antigravity)
 */

import { CLIENT_METADATA } from "../../config/appConstants.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "../../providers/shared.js";
import { U, parseResetTime, normalizeCloudCodeProjectId, fetchWithTimeout } from "./shared.js";

// Antigravity API config (from Quotio) — urls from registry, oauth client + dynamic UA kept here
const ANTIGRAVITY_CONFIG = {
  ...U("antigravity"),
  ...ANTIGRAVITY_OAUTH_CLIENT,
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
export async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const response = await fetchWithTimeout(
      U("gemini-cli").quotaUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
      },
      10000,
      proxyOptions
    );

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(
      U("gemini-cli").loadCodeAssistUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA }),
      },
      10000,
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Antigravity weekly-quota fetch + parse (port of OmniRoute #6818).
 *
 * Antigravity enforces both a 5-hour window (surfaced per-model below via
 * `fetchAvailableModels`) and a separate weekly window. The weekly window is NOT
 * part of the per-model `fetchAvailableModels` response — it lives in a distinct
 * upstream RPC, `v1internal:retrieveUserQuotaSummary`, which groups models into
 * families ("Gemini Models", "Claude and GPT models") and reports one bucket per
 * family per window (5h + weekly), keyed by `bucketId`/`displayName` rather than
 * modelId. The window is inferred from bucket text (no explicit type field).
 *
 * Best-effort: a failed/unavailable RPC NEVER breaks the existing per-model rows.
 * The dashboard renders `quota.displayName || modelKey`
 * (ProviderLimits/utils.js#parseQuotaData), so `displayName` carries the friendly
 * weekly label ("Gemini Weekly") — no dashboard file changes needed.
 */
const WEEKLY_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const WEEKLY_QUOTA_CACHE_TTL_MS = 60 * 1000;
const _weeklyQuotaCache = new Map();
const _weeklyQuotaInflight = new Map();

// This cache is owned here, so its cleanup timer lives here too.
const _weeklyQuotaCacheCleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of _weeklyQuotaCache) {
      if (now - entry.fetchedAt > WEEKLY_QUOTA_CACHE_TTL_MS) _weeklyQuotaCache.delete(key);
    }
  },
  5 * 60 * 1000
);
_weeklyQuotaCacheCleanupTimer.unref?.();

function _toWeeklyRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Fetch the weekly-quota-bearing `retrieveUserQuotaSummary` response (cached, best-effort).
 * Returns `null` on any failure — optional data, never a hard dependency, since the RPC
 * is undocumented and may not be available for every account/tier. Cache key uses the
 * full token (a truncated prefix could collide across accounts and leak quota rows).
 */
async function fetchAntigravityUserQuotaSummaryCached(accessToken, projectId, { headers, proxyOptions } = {}) {
  if (!accessToken || !projectId) return null;

  const cacheKey = `${accessToken}:${projectId || "default"}`;
  const cached = _weeklyQuotaCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < WEEKLY_QUOTA_CACHE_TTL_MS) {
    return cached.data;
  }

  const inflight = _weeklyQuotaInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const response = await fetchWithTimeout(
        WEEKLY_QUOTA_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(headers || {}),
          },
          body: JSON.stringify({ project: projectId }),
        },
        10000,
        proxyOptions || null
      );
      if (!response.ok) return null;
      const data = await response.json();
      _weeklyQuotaCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    } catch {
      return null;
    }
  })().finally(() => {
    _weeklyQuotaInflight.delete(cacheKey);
  });

  _weeklyQuotaInflight.set(cacheKey, promise);
  return promise;
}

const WEEKLY_KEYWORD = /\bweekly\b/;

/** Turns a group displayName (e.g. "Gemini Models", "Claude and GPT models") into a quota key. */
function slugifyGroupWeeklyKey(displayName) {
  const cleaned = String(displayName || "")
    .toLowerCase()
    .replace(/\bmodels?\b/g, "")
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned ? `${cleaned}_weekly` : null;
}

/** Friendly row label per weekly quota key (dashboard renders `displayName`). */
const WEEKLY_DISPLAY_LABELS = {
  gemini_weekly: "Gemini Weekly",
  claude_gpt_weekly: "Claude & GPT Weekly",
};

/**
 * Parse the raw `retrieveUserQuotaSummary` response into weekly quota entries, one per
 * model family group. Tolerant of both observed envelopes (`groups[]` top-level or
 * nested under `quotaSummary.groups[]`). Missing/partial payloads yield `{}` (or skip
 * the incomplete group) — best-effort, never fabricated rows.
 */
export function parseAntigravityWeeklyQuotas(summaryData) {
  const root = _toWeeklyRecord(summaryData);
  const rawGroups = Array.isArray(root.groups)
    ? root.groups
    : Array.isArray(_toWeeklyRecord(root.quotaSummary).groups)
      ? _toWeeklyRecord(root.quotaSummary).groups
      : [];

  const quotas = {};

  for (const groupValue of rawGroups) {
    const group = _toWeeklyRecord(groupValue);
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    const weeklyBucketValue = buckets.find((b) => {
      if (!b || typeof b !== "object") return false;
      const bucket = _toWeeklyRecord(b);
      return WEEKLY_KEYWORD.test(`${String(bucket.bucketId || "")} ${String(bucket.displayName || "")}`.toLowerCase());
    });
    if (!weeklyBucketValue) continue;

    const weeklyBucket = _toWeeklyRecord(weeklyBucketValue);
    if (weeklyBucket.disabled === true) continue;

    const key = slugifyGroupWeeklyKey(String(group.displayName || ""));
    if (!key) continue;

    // Partial-payload guard: accept only a finite number or nonblank numeric string.
    // null/"" coerce to 0 (fabricated depleted quota); objects may throw in Number().
    const rawValue = weeklyBucket.remainingFraction;
    const usable =
      (typeof rawValue === "number" && Number.isFinite(rawValue)) ||
      (typeof rawValue === "string" && rawValue.trim() !== "");
    if (!usable) continue;
    const rawFraction = Number(rawValue);
    if (!Number.isFinite(rawFraction) || rawFraction < 0) continue;

    const remainingFraction = Math.max(0, Math.min(1, rawFraction));
    const resetAt = parseResetTime(weeklyBucket.resetTime);
    const isUnlimited = !resetAt && remainingFraction >= 1;
    const total = 1000; // Normalized base, matches per-model convention
    const remaining = Math.round(total * remainingFraction);

    quotas[key] = {
      used: isUnlimited ? 0 : Math.max(0, total - remaining),
      total: isUnlimited ? 0 : total,
      resetAt,
      remainingPercentage: isUnlimited ? 100 : remainingFraction * 100,
      unlimited: isUnlimited,
      displayName: WEEKLY_DISPLAY_LABELS[key] || String(group.displayName || "").trim() || key,
    };
  }

  return quotas;
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
export async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    // Prefer the connection-stored project id (#1271 convention) — the loadCodeAssist
    // response is only a fallback and may be partial for some accounts.
    const projectId =
      normalizeCloudCodeProjectId(providerSpecificData?.projectId) ||
      normalizeCloudCodeProjectId(subscriptionInfo?.cloudaicompanionProject) ||
      null;

    // Fetch the 5h per-model quota and the weekly summary RPC in parallel after
    // project resolution. The weekly window lives only in `retrieveUserQuotaSummary`
    // (grouped by model family, not per-model); best-effort — an unavailable/failed
    // RPC yields `{}` and never affects the existing per-model rows.
    const weeklyPromise = fetchAntigravityUserQuotaSummaryCached(accessToken, projectId, {
      proxyOptions,
      // Same official IDE headers as the 5h quota call (single source: ANTIGRAVITY_CONFIG).
      headers: {
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
    }).then(parseAntigravityWeeklyQuotas);
    const [response, weeklyQuotas] = await Promise.all([
      fetchWithTimeout(ANTIGRAVITY_CONFIG.quotaApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {})
        }),
      }, 10000, proxyOptions),
      weeklyPromise,
    ]);

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas = {};

    // Parse model quotas (inspired by vscode-antigravity-cockpit)
    if (data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3-flash-agent',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        'gemini-3-flash',
        // Image generation models
        'gemini-3.1-flash-image',
        'gemini-3-pro-image',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
        };
      }
    }

    Object.assign(quotas, weeklyQuotas);

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
    }, 10000, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  }
}
