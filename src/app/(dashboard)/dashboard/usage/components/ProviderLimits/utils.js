import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// ─── Constants ───────────────────────────────────────────────────────────────
import { isBrowser, isNumber, isObject, isString, isUndefined } from "../../../../../../shared/utils/typeChecks.js";
export const QUOTA_CACHE_KEY = "quotaCacheData";
// Source of truth for both the auto-refresh scheduler cadence (createAutoRefreshScheduler
// below) and the dashboard's displayed countdown resets (ProviderLimits/index.js derives
// REFRESH_INTERVAL_S from this instead of hardcoding seconds).
export const REFRESH_INTERVAL_MS = 300000;
// Claude usage/quota endpoint rate-limits aggressively; poll it far less often
// than other providers. The server side (open-sse/services/usage/claude.js)
// matches this cadence with a 30-minute cache TTL plus an escalating 429
// cooldown, so most ticks read the cache instead of hitting Anthropic.
export const CLAUDE_REFRESH_INTERVAL_MS = 1800000;
export const DEPLETED_QUOTA_THRESHOLD = 5;
export const AUTO_REFRESH_STORAGE_KEY = "quotaAutoRefresh";
export const CONNECTIONS_PAGE_SIZE = 20;
export const ACCOUNT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const ACCOUNT_PAGE_SIZE_MAX = 500;
export const ACCOUNT_FILTER_OPTIONS = [
{ value: "all", label: "All accounts" },
{ value: "active", label: "Active" },
{ value: "inactive", label: "Turned off" }];

export const QUOTA_SORT_OPTIONS = [
{ value: "default", label: "Default quota order" },
{ value: "remaining-asc", label: "% quota: low to high" },
{ value: "remaining-desc", label: "% quota: high to low" }];


export function getRefreshCountdown(nextRefreshAt, now = Date.now()) {
  if (!Number.isFinite(nextRefreshAt)) return 0;
  return Math.max(0, Math.ceil((nextRefreshAt - now) / 1000));
}

export function createAutoRefreshScheduler({
  intervalMs = REFRESH_INTERVAL_MS,
  onRefresh,
  onCountdown = () => {},
  isHidden = () => !isUndefined(globalThis.document) && document.hidden,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  let stopped = true;
  let refreshTimer = null;
  let countdownTimer = null;
  let nextRefreshAt = null;
  let running = null;

  const clearTimers = () => {
    if (refreshTimer) clearTimeoutFn(refreshTimer);
    if (countdownTimer) clearIntervalFn(countdownTimer);
    refreshTimer = null;
    countdownTimer = null;
  };

  const publishCountdown = () => {
    onCountdown(getRefreshCountdown(nextRefreshAt, now()));
  };

  const schedule = () => {
    clearTimers();
    if (stopped || isHidden()) return;
    if (!Number.isFinite(nextRefreshAt)) nextRefreshAt = now() + intervalMs;

    publishCountdown();
    refreshTimer = setTimeoutFn(() => {
      void runRefresh(false).catch(() => {});
    }, Math.max(0, nextRefreshAt - now()));
    countdownTimer = setIntervalFn(publishCountdown, 1000);
  };

  function runRefresh(force) {
    if (running) return running;
    if (!force && isHidden()) {
      clearTimers();
      return Promise.resolve();
    }

    clearTimers();
    running = Promise.resolve().
    then(() => onRefresh(force)).
    finally(() => {
      running = null;
      if (stopped) return;
      nextRefreshAt = now() + intervalMs;
      schedule();
    });
    return running;
  }

  return {
    start() {
      stopped = false;
      nextRefreshAt = now() + intervalMs;
      schedule();
    },
    pause() {
      clearTimers();
      publishCountdown();
    },
    resume() {
      if (stopped) return Promise.resolve();
      if (!Number.isFinite(nextRefreshAt)) nextRefreshAt = now() + intervalMs;
      if (nextRefreshAt <= now()) return runRefresh(false);
      schedule();
      return Promise.resolve();
    },
    refreshNow() {
      return runRefresh(true);
    },
    stop() {
      stopped = true;
      clearTimers();
    },
    getNextRefreshAt() {
      return nextRefreshAt;
    }
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
// ┌────────────────────────────────────────────────────────────────────────────┐
// │ Quota-visibility helpers                                                   │
// │                                                                              │
// │ These utilities let users hide individual quota rows per provider.          │
// │ Quota rows are identified by a stable key (`modelKey` when available,        │
// │ otherwise a composite of the display name and array index).                │
// └────────────────────────────────────────────────────────────────────────────┘

/** Prefer registry names so stale saved labels cannot misidentify providers. */
export function getConnectionLabel(connection) {
  return AI_PROVIDERS[connection.provider]?.name?.trim() ||
  connection.name?.trim() ||
  connection.email?.trim() ||
  connection.displayName?.trim() ||
  null;
}

export function getConnectionQuotaRemaining(connection, quotaData) {
  const quota = quotaData[connection.id]?.quotas?.[0];
  if (!quota) return Number.POSITIVE_INFINITY;
  if (isNumber(quota.remaining)) return quota.remaining;
  return Number.POSITIVE_INFINITY;
}

export function sortVisibleConnections(
connections,
quotaData,
expiringFirst,
providerFilter,
quotaSortMode)
{
  if (providerFilter === "codex" && quotaSortMode !== "default") {
    return [...connections].sort((a, b) => {
      const remainingA = getConnectionQuotaRemaining(a, quotaData);
      const remainingB = getConnectionQuotaRemaining(b, quotaData);
      const remainingDiff =
      quotaSortMode === "remaining-asc" ?
      remainingA - remainingB :
      remainingB - remainingA;
      if (remainingDiff !== 0) return remainingDiff;
      return (getConnectionLabel(a) || "").localeCompare(
        getConnectionLabel(b) || ""
      );
    });
  }

  if (!expiringFirst) return connections;

  const getEarliestResetTime = (connection) => {
    const resetTimes = (quotaData[connection.id]?.quotas || []).
    map((quota) =>
    quota.resetAt ?
    new Date(quota.resetAt).getTime() :
    Number.POSITIVE_INFINITY
    ).
    filter((time) => Number.isFinite(time));
    return resetTimes.length > 0 ?
    Math.min(...resetTimes) :
    Number.POSITIVE_INFINITY;
  };

  return [...connections].sort((a, b) => {
    const expiryDiff = getEarliestResetTime(a) - getEarliestResetTime(b);
    if (expiryDiff !== 0) return expiryDiff;
    return (
      (a.provider || "").localeCompare(b.provider || "") ||
      (getConnectionLabel(a) || "").localeCompare(getConnectionLabel(b) || ""));

  });
}

/** Returns the exact connection set that a refresh will fetch and mark loading. */
export function getRefreshConnections(connections, force, tick, claudeEvery) {
  return connections.filter((connection) =>
  force || connection.provider !== "claude" || tick % claudeEvery === 0
  );
}

/** Dispatches the selected Refresh All connections with its force intent intact. */
export function refreshProviderQuotas(connections, force, fetchQuota) {
  return Promise.all(
    connections.map((connection) => fetchQuota(connection.id, connection.provider, { force }))
  );
}

export function buildLoadingState(connections) {
  const nextLoadingState = {};
  connections.forEach((connection) => {
    nextLoadingState[connection.id] = true;
  });
  return nextLoadingState;
}

export function filterQuotaStateByConnections(state, connections) {
  const visibleIds = new Set(connections.map((connection) => connection.id));
  return Object.fromEntries(
    Object.entries(state).filter(([id]) => visibleIds.has(id))
  );
}

export function getConnectionsPageRange(pagination) {
  if (!pagination.total) {
    return { start: 0, end: 0 };
  }
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return { start, end };
}

export function getConnectionsEmptyMessage(totals, providerFilter, accountFilter) {
  if (!totals.eligibleConnections) {
    return {
      icon: "cloud_off",
      title: "No Providers Connected",
      description:
      "Connect to providers with OAuth to track your API quota limits and usage."
    };
  }
  if (!totals.providerFilteredConnections) {
    return {
      icon: "filter_alt_off",
      title: "No Accounts Match Current Filters",
      description:
      providerFilter === "all" ?
      "Try changing the account status filter to see more quota trackers." :
      `No ${accountFilter === "inactive" ? "turned off" : accountFilter === "active" ? "active" : "matching"} accounts found for ${providerFilter}.`
    };
  }
  return {
    icon: "filter_alt_off",
    title: "No Accounts On This Page",
    description:
    "Try moving to another page or refreshing the current filters."
  };
}

export function sortRequestFromExpiringFirst(expiringFirst) {
  return expiringFirst ? "expiring" : "priority";
}

export function getPageSizeLabel(pageSize, isCustomPageSize) {
  return isCustomPageSize ? `Custom: ${pageSize} / page` : `${pageSize} / page`;
}

export function getConnectionsPaginationSummary(pagination) {
  const { start, end } = getConnectionsPageRange(pagination);
  return `Showing ${start}-${end} of ${pagination.total}`;
}

export function getSafePagination(pagination, fallbackPageSize) {
  return (
    pagination || {
      page: 1,
      pageSize: fallbackPageSize,
      total: 0,
      totalPages: 1
    });

}

export function getSafeTotals(totals, fallbackTotal = 0) {
  return (
    totals || {
      eligibleConnections: fallbackTotal,
      providerFilteredConnections: fallbackTotal
    });

}

export function shouldResetPage(previousValue, nextValue) {
  return previousValue !== nextValue;
}

export function getPaginationPageValue(dataPagination, fallbackPage) {
  return dataPagination?.page || fallbackPage;
}

export function getProviderOptions(dataProviderOptions) {
  return dataProviderOptions || [];
}

export async function reconcileConnectionsPage(fetchConnections, targetPage) {
  return await fetchConnections(targetPage);
}

export function getQuotaCache() {
  if (!isBrowser()) return {};
  try {
    const cached = window.localStorage.getItem(QUOTA_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch (error) {
    console.error("Error reading quota cache:", error);
    return {};
  }
}

export function setQuotaCache(connectionId, quotaEntry) {
  if (!isBrowser()) return;
  try {
    const cache = getQuotaCache();
    cache[connectionId] = {
      ...quotaEntry,
      cachedAt: new Date().toISOString()
    };
    window.localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Error writing quota cache:", error);
  }
}

/**
 * Format ISO date string to countdown format (inspired by vscode-antigravity-cockpit)
 * @param {string|Date} date - ISO date string or Date object
 * @returns {string} Formatted countdown (e.g., "2d 5h 30m", "4h 40m", "15m") or "-"
 */
export function formatResetTime(date) {
  if (!date) return "-";

  try {
    const resetDate = isString(date) ? new Date(date) : date;
    const now = new Date();
    const diffMs = resetDate - now;

    if (diffMs <= 0) return "-";

    const totalMinutes = Math.ceil(diffMs / (1000 * 60));

    // < 60 minutes: show only minutes
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }

    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;

    // < 24 hours: show hours and minutes
    if (totalHours < 24) {
      return `${totalHours}h ${remainingMinutes}m`;
    }

    // >= 24 hours: show days, hours, and minutes
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  } catch (error) {
    return "-";
  }
}

/**
 * Get Tailwind color class based on percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Color name: "green" | "yellow" | "red"
 */
export function getStatusColor(percentage) {
  if (percentage > 70) return "green";
  if (percentage >= 30) return "yellow";
  return "red"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Get status emoji based on percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Emoji: "🟢" | "🟡" | "🔴"
 */
export function getStatusEmoji(percentage) {
  if (percentage > 70) return "🟢";
  if (percentage >= 30) return "🟡";
  return "🔴"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Calculate remaining percentage
 * @param {number} used - Used amount
 * @param {number} total - Total amount
 * @returns {number} Remaining percentage (0-100)
 */
export function calculatePercentage(used, total) {
  if (!total || total === 0) return 0;
  if (!used || used < 0) return 100;
  if (used >= total) return 0;

  return Math.round((total - used) / total * 100);
}

/**
 * Get remaining percentage from a normalized quota row
 * @param {Object} quota - Normalized quota object
 * @returns {number} Remaining percentage (0-100)
 */
export function getRemainingPercentage(quota) {
  // Credits rows carry an absolute balance in `remaining` (e.g. 4000 credits),
  // not a 0-100 percentage — read the percentage field first for those.
  if (quota?.isCredits && quota?.remainingPercentage !== undefined) {
    return Math.max(0, Math.round(quota.remainingPercentage));
  }

  if (quota?.remaining !== undefined) {
    return Math.max(0, Math.round(quota.remaining));
  }

  if (quota?.remainingPercentage !== undefined) {
    return Math.round(quota.remainingPercentage);
  }

  return calculatePercentage(quota?.used, quota?.total);
}

/**
 * Build a stable key used to identify a quota row for visibility settings.
 *
 * Prefer `quota.modelKey` when present. For positional display names such as
 * "Month 1" / "Month 2", fall back to a composite key that includes the row's
 * 0-based array index so reordering does not collapse distinct rows.
 *
 * @param {Object} quota - Normalized quota row
 * @param {number} [index] - 0-based position of the row in its array
 * @returns {string} Stable visibility key
 */
export function getQuotaVisibilityKey(quota, index) {
  if (!quota || !isObject(quota)) return "";
  if (quota.modelKey) return String(quota.modelKey).trim();
  const name = String(quota.name || "").trim();
  if (name === "") return "";
  if (index === undefined || index === null) return name;
  return `${name}::${index}`;
}

/**
 * Trim hidden quota keys to only those matching currently valid quotas.
 * Stale or obsolete model keys are dropped. Keys are computed with the same
 * modelKey / `name::index` scheme that filter/getHiddenQuotaRows use.
 *
 * @param {Array<string>} [hidden=[]] - Saved hidden keys
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows
 * @returns {Array<string>} Deduplicated hidden keys still present in quotas
 */
export function trimHiddenQuotaKeys(hidden = [], quotas = []) {
  if (!Array.isArray(hidden) || hidden.length === 0) return [];
  const validKeys = new Set(
    quotas.map((quota, index) => getQuotaVisibilityKey(quota, index)).filter(Boolean)
  );
  return [...new Set(hidden.map((k) => String(k).trim()).filter((k) => validKeys.has(k)))];
}

/**
 * Resolve hidden quota keys for a connection, falling back to its provider's
 * legacy entry when no connection-specific preference exists. When the current
 * quota rows are supplied, stale keys that no longer match any row are dropped
 * (upstream f615a83).
 *
 * @param {string} scopeKey - Connection identifier
 * @param {Object} quotaVisibility - Saved visibility settings
 * @param {string} [legacyScopeKey] - Legacy provider identifier
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows for trimming
 * @returns {Set<string>} Normalized hidden quota keys
 */
function getHiddenQuotaSet(scopeKey, quotaVisibility, legacyScopeKey, quotas = []) {
  const scopedHidden = quotaVisibility?.[scopeKey]?.hidden;
  let hidden;
  if (Array.isArray(scopedHidden)) {
    hidden = scopedHidden.map((item) => String(item).trim()).filter(Boolean);
  } else if (legacyScopeKey && legacyScopeKey !== scopeKey) {
    const legacyHidden = quotaVisibility?.[legacyScopeKey]?.hidden;
    hidden = Array.isArray(legacyHidden)
      ? legacyHidden.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } else {
    hidden = [];
  }
  // Builds before the canonical Claude quota ordering persisted rows as
  // `<name>::<index>`; the sort reindexes rows, so keep those settings
  // effective by also matching on the stable name prefix. Claude row names
  // are unique per connection, so the prefix is unambiguous.
  if ((legacyScopeKey || scopeKey) === "claude") {
    for (const key of [...hidden]) {
      const name = key.replace(/::\d+$/, "");
      if (name !== key) hidden.push(name);
    }
  }
  // Prune keys for quotas that no longer exist (after the name-prefix
  // expansion above so stable Claude names are trimmed against live rows).
  if (quotas.length > 0) hidden = trimHiddenQuotaKeys(hidden, quotas);
  return new Set(hidden);
}

/**
 * Update one connection's hidden quota keys. A first connection-scoped write
 * starts from any legacy provider entry so existing preferences remain active.
 *
 * @param {Object} quotaVisibility - Saved visibility settings
 * @param {string} connectionId - Connection identifier
 * @param {string} provider - Legacy provider identifier
 * @param {string} quotaKey - Stable quota row key
 * @param {boolean} hidden - Whether the quota row should be hidden
 * @returns {Object} Updated visibility settings
 */
export function updateQuotaVisibility(
quotaVisibility,
connectionId,
provider,
quotaKey,
hidden)
{
  const connectionVisibility = quotaVisibility[connectionId];
  const legacyVisibility = quotaVisibility[provider];
  const hiddenKeys = new Set(
    connectionVisibility?.hidden || (connectionId !== provider ? legacyVisibility?.hidden : []) || []
  );
  if (hidden) hiddenKeys.add(quotaKey);else
  hiddenKeys.delete(quotaKey);
  // Antigravity now groups text models under the family keys "gemini" and
  // "claude" (upstream f615a83): toggling a family row supersedes any stale
  // per-model keys, which are pruned so they cannot linger invisibly. The
  // Antigravity CLI provider ("agy") shares the same usage handler and
  // grouped rows, so the prune applies to both provider ids.
  if (provider === "antigravity" || provider === "agy") {
    if (quotaKey === "gemini") {
      for (const k of hiddenKeys) {
        if (k.startsWith("gemini-") && !k.includes("image")) hiddenKeys.delete(k);
      }
    } else if (quotaKey === "claude") {
      for (const k of hiddenKeys) {
        if (k.startsWith("claude-")) hiddenKeys.delete(k);
      }
    }
  }
  return {
    ...quotaVisibility,
    [connectionId]: {
      ...connectionVisibility,
      hidden: [...hiddenKeys]
    }
  };
}

/**
 * Return quota rows visible for a connection, with provider-keyed legacy fallback.
 *
 * @param {string} scopeKey - Connection identifier
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows
 * @param {Object} [quotaVisibility={}] - Visibility settings by connection
 * @param {string} [legacyScopeKey] - Legacy provider identifier
 * @returns {Array<Object>} Quota rows that are not hidden
 */
export function filterQuotasByVisibility(
scopeKey,
quotas = [],
quotaVisibility = {},
legacyScopeKey)
{
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getHiddenQuotaSet(scopeKey, quotaVisibility, legacyScopeKey, quotas);
  if (hidden.size === 0) return quotas;
  return quotas.filter((quota, index) => !hidden.has(getQuotaVisibilityKey(quota, index)));
}

/**
 * Return quota rows hidden for a connection, with provider-keyed legacy fallback.
 *
 * @param {string} scopeKey - Connection identifier
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows
 * @param {Object} [quotaVisibility={}] - Visibility settings by connection
 * @param {string} [legacyScopeKey] - Legacy provider identifier
 * @returns {Array<Object>} Hidden quota rows
 */
export function getHiddenQuotaRows(
scopeKey,
quotas = [],
quotaVisibility = {},
legacyScopeKey)
{
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getHiddenQuotaSet(scopeKey, quotaVisibility, legacyScopeKey, quotas);
  if (hidden.size === 0) return [];
  return quotas.filter((quota, index) => hidden.has(getQuotaVisibilityKey(quota, index)));
}

/**
 * Build a credits-style quota row (absolute balance, not a request window).
 * `remaining`/`creditCount` hold the raw credit balance; `remainingPercentage`
 * carries the 0-100 display value (getRemainingPercentage prefers it for
 * isCredits rows so a 4,000-credit balance is never rendered as "4,000%").
 */
function buildCreditsQuota(name, remaining, remainingPercentage, extra = {}) {
  return {
    name,
    used: 0,
    total: 0,
    remaining,
    resetAt: null,
    unlimited: false,
    isCredits: true,
    remainingPercentage,
    creditCount: remaining,
    ...extra
  };
}

function buildClaudeExtraUsageQuota(extraUsage) {
  const monthlyLimit = Number(extraUsage?.monthly_limit ?? 0);
  const usedCredits = Number(extraUsage?.used_credits ?? 0);
  const utilization = Number(extraUsage?.utilization ?? 0);
  const remainingPercentage = Number.isFinite(utilization) ?
  Math.max(0, 100 - utilization) :
  undefined;
  const remaining = Number.isFinite(monthlyLimit) ? Math.max(0, monthlyLimit - usedCredits) : 0;

  return buildCreditsQuota("extra_usage", remaining, remainingPercentage ?? 100, {
    used: Number.isFinite(usedCredits) ? usedCredits : 0,
    total: Number.isFinite(monthlyLimit) ? monthlyLimit : 0,
    currency: extraUsage?.currency
  });
}

/**
 * Parse provider-specific quota structures into normalized array
 * @param {string} provider - Provider name (github, antigravity, agy, codex, kiro, claude)
 * @param {Object} data - Raw quota data from provider
 * @returns {Array<Object>} Normalized quota objects with { name, used, total, resetAt }
 */
export function parseQuotaData(provider, data) {
  if (!data || !isObject(data)) return [];

  const normalizedQuotas = [];

  try {
    switch (provider.toLowerCase()) {
      case "github":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "agy": // Antigravity CLI shares the Antigravity usage handler (open-sse/services/usage.js)
      case "antigravity":
        if (data.quotas) {
          const entries = Object.entries(data.quotas);
          const geminiModels = entries.filter(([k]) => k.startsWith("gemini-") && !k.includes("image"));
          // Image models are excluded from the Claude family for the same
          // reason as Gemini above: an image row belongs to its own row, and
          // folding it into the family would also duplicate it (the image
          // filter below matches any key containing "image").
          const claudeModels = entries.filter(([k]) => k.startsWith("claude-") && !k.includes("image"));
          const imageModels = entries.filter(([k]) => k.includes("image"));
          const otherModels = entries.filter(([k]) => !k.startsWith("gemini-") && !k.startsWith("claude-") && !k.includes("image"));

          if (geminiModels.length > 0) {
            const rep = geminiModels.reduce((min, cur) =>
              (cur[1].remainingPercentage ?? 100) < (min[1].remainingPercentage ?? 100) ? cur : min
            )[1];
            normalizedQuotas.push({
              name: "Gemini (Flash / Pro)",
              modelKey: "gemini",
              used: rep.used || 0,
              total: rep.total || 0,
              resetAt: rep.resetAt || null,
              remainingPercentage: rep.remainingPercentage,
            });
          }

          if (claudeModels.length > 0) {
            const rep = claudeModels.reduce((min, cur) =>
              (cur[1].remainingPercentage ?? 100) < (min[1].remainingPercentage ?? 100) ? cur : min
            )[1];
            normalizedQuotas.push({
              name: "Claude (Sonnet / Opus)",
              modelKey: "claude",
              used: rep.used || 0,
              total: rep.total || 0,
              resetAt: rep.resetAt || null,
              remainingPercentage: rep.remainingPercentage,
            });
          }

          imageModels.forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          });

          otherModels.forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "codex":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              remaining: quota.remaining,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "kiro":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "qoder":
        // Qoder ships a `user` quota and (optionally) an `organization`
        // quota, both with same shape: {total, used, remaining, unit, resetAt}.
        /**
         * Hide only all-zero organization placeholders; a zero reported total
         * can still carry meaningful usage and is inferred from used + remaining.
         */
        // Don't forward Qoder's `remaining` field: it's an absolute credit
        // count, but getRemainingPercentage / QuotaTable interpret
        // `remaining` as a 0-100 percentage and would render 348 credits
        // as "348%". The percentage is computed from used/total instead.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            if (
            quotaType === "organization" && (
            !quota || [quota.total, quota.used, quota.remaining].
            every((value) => (Number(value) || 0) === 0)))
            {
              return;
            }
            normalizedQuotas.push({
              name: quotaType === "user" ? "Personal" : quotaType === "organization" ? "Organization" : quotaType,
              used: quota.used || 0,
              total: Math.max(0, Number(quota.total) || 0) ||
              (Number(quota.used) || 0) + (Number(quota.remaining) || 0),
              unit: quota.unit,
              resetAt: quota.resetAt || null
            });
          });
        }
        break;

      case "claude":
        if (data.message) {
          // Handle error message case
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: data.message
          });
        } else {
          if (data.quotas) {
            Object.entries(data.quotas).forEach(([name, quota]) => {
              normalizedQuotas.push({
                name,
                used: quota.used || 0,
                total: quota.total || 0,
                resetAt: quota.resetAt || null,
                // Do NOT forward `remaining`: admin/legacy payloads carry an
                // absolute request count there, and getRemainingPercentage
                // prefers `remaining` over the derived percentage — a row like
                // {used:1000,total:5000,remaining:4000} would render "4,000%".
                // Percentage comes from remainingPercentage or used/total.
                remainingPercentage: quota.remainingPercentage
              });
            });
          }
          // #6806: some Claude plans (e.g. "default_raven_enterprise") return no
          // five_hour/seven_day utilization windows at all — only a credit-billing
          // extraUsage block — so quotas can be {} while extraUsage still holds real,
          // actionable usage data. Fold it in as a credits-style row instead of
          // falling back to "No quota data".
          if (data.extraUsage?.is_enabled) {
            normalizedQuotas.push(buildClaudeExtraUsageQuota(data.extraUsage));
          }
        }
        break;

      case "vercel-ai-gateway":
        // Vercel returns currency credit balance, not request quotas.
        // The 'Remaining (USD)' row needs explicit remainingPercentage because
        // its used/total values would otherwise compute the wrong direction
        // (e.g. used=95.5 / total=100 → 4% instead of 96%).
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "codebuddy-cn":
        // CodeBuddy CN mixes recurring refill packs ("Monthly"/"Weekly"/...)
        // with one-shot bonus packs ("Bonus Pack N"). Forward `recurring`
        // so the UI can show "Expires in" for bonus packs (whose resetAt is
        // a hard expiry, not a refresh) instead of "Reset in".
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              recurring: quota.recurring !== false
            });
          });
        }
        break;
      case "grok-cli":
        // Grok CLI / Grok Build (SuperGrok + X Premium+) returns raw.quotas
        // as a { productName: { used, total, remainingPercentage, resetAt } }
        // map. The dashboard rows expect used / total / remainingPercentage
        // (so the percent bar renders); fall back to a derived percent when
        // the upstream doesn't supply it.
        if (data.quotas && isObject(data.quotas) && !Array.isArray(data.quotas)) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            const used = isNumber(quota?.used) ? quota.used : 0;
            const total = isNumber(quota?.total) ? quota.total : 0;
            const remainingPercentage = isNumber(quota?.remainingPercentage) ?
            quota.remainingPercentage :
            total > 0 ? Math.max(0, Math.min(100, Math.round((total - used) / total * 100))) : 0;
            normalizedQuotas.push({
              name,
              used,
              total,
              remainingPercentage,
              ...(quota?.resetAt ? { resetAt: quota.resetAt } : null)
            });
          });
        }
        break;

      case "kimi":
        // Weekly / Ratelimit from /v1/usages. Prefer remainingPercentage only.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "deepseek":
        // Credit balance — remainingPercentage only (no absolute remaining).
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      case "ollama":
        // Session (5h) / Weekly (7d) usage from ollama.com/api/usage. Carries
        // remainingPercentage only — the API reports a ratio, not an absolute
        // remaining count, and the bar reads the percentage.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage
            });
          });
        }
        break;

      default:
        // Generic fallback for unknown providers
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              remaining: quota.remaining !== undefined ? quota.remaining : undefined,
              unlimited: quota.unlimited || false,
              resetAt: quota.resetAt || null
            });
          });
        }
    }
  } catch (error) {
    console.error(`Error parsing quota data for ${provider}:`, error);
    return [];
  }

  if (provider?.toLowerCase() === "claude") {
    // Claude row names are unique per connection, so key each row by name
    // (via modelKey) instead of array index: the canonical sort below would
    // otherwise move rows and silently invalidate persisted hidden-row keys
    // of the form `<name>::<index>`.
    for (const quota of normalizedQuotas) {
      if (!quota.modelKey && quota.name) quota.modelKey = String(quota.name).trim();
    }
    const CLAUDE_QUOTA_ORDER = {
      "session (5h)": 0,
      "weekly (7d)": 1,
      "weekly fable (7d)": 2,
      "weekly opus (7d)": 3,
      "weekly sonnet (7d)": 4,
    };
    normalizedQuotas.sort((a, b) => (CLAUDE_QUOTA_ORDER[a.name] ?? 99) - (CLAUDE_QUOTA_ORDER[b.name] ?? 99));
    return normalizedQuotas;
  }

  // Sort quotas according to PROVIDER_MODELS order
  const modelOrder = getModelsByProviderId(provider);
  if (modelOrder.length > 0) {
    const orderMap = new Map(modelOrder.map((m, i) => [m.id, i]));

    normalizedQuotas.sort((a, b) => {
      // Use modelKey for antigravity (mapped to family anchor), otherwise use name
      let keyA = a.modelKey || a.name;
      let keyB = b.modelKey || b.name;
      // Fork deviation from upstream f615a83: this catalog has no
      // "gemini-3.8-flash-high"; anchor the grouped Gemini row at the first
      // Gemini text model ("gemini-3.7-flash-high") so it sorts with the family.
      if (keyA === "gemini") keyA = "gemini-3.7-flash-high";
      if (keyA === "claude") keyA = "claude-sonnet-4-6";
      if (keyB === "gemini") keyB = "gemini-3.7-flash-high";
      if (keyB === "claude") keyB = "claude-sonnet-4-6";
      const orderA = orderMap.get(keyA) ?? 999;
      const orderB = orderMap.get(keyB) ?? 999;
      return orderA - orderB;
    });
  }

  return normalizedQuotas;
}