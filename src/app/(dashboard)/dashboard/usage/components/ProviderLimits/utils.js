// Quota visibility and provider parsers live in sibling modules; re-exported here so existing imports keep working.
export {
  getQuotaVisibilityKey,
  trimHiddenQuotaKeys,
  updateQuotaVisibility,
  filterQuotasByVisibility,
  getHiddenQuotaRows } from
"./quotaVisibility";
export { parseQuotaData } from "./quotaParsers";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// ─── Constants ───────────────────────────────────────────────────────────────
import { isBrowser, isObject, isString, isUndefined } from "../../../../../../shared/utils/typeChecks.js";
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
  const values = getUsableQuotaPercentages(quotaData[connection.id]?.quotas);
  return values.length ? Math.max(...values) : Number.POSITIVE_INFINITY;
}

// Ignore unreported rows; a zero total alone does not establish depletion.
// Spend rows are not quotas, and an estimate must not get an account disabled.
function getUsableQuotaPercentages(quotas = []) {
  return quotas.filter((quota) => quota && !quota.notReported && !quota.unlimited && !quota.isSpend && !quota.isEstimate && (
    Number.isFinite(quota.remainingPercentage) ||
    (!quota.isCredits && Number.isFinite(quota.remaining)) ||
    (Number.isFinite(quota.total) && quota.total > 0 && Number.isFinite(quota.used))
  )).map(getRemainingPercentage).filter(Number.isFinite);
}

/** Earliest finite quota reset timestamp across rows, or Infinity when none is reported (#5898). */
export function getEarliestQuotaResetTime(quotas = []) {
  return (quotas || []).reduce((earliest, { resetAt } = {}) => {
    const time = resetAt ? new Date(resetAt).getTime() : NaN;
    return Number.isFinite(time) ? Math.min(earliest, time) : earliest;
  }, Number.POSITIVE_INFINITY);
}

/**
 * Classify a connection's measured quota availability for bulk actions (#5898).
 * Returns "unknown" when no usable measured pool exists so unreported accounts are neither disabled nor enabled.
 */
export function getQuotaAvailability(quotas = [], threshold = DEPLETED_QUOTA_THRESHOLD) {
  if (quotas?.some((quota) => quota?.unlimited)) return "available";
  const values = getUsableQuotaPercentages(quotas);
  if (values.length === 0) return "unknown";
  return values.every((value) => value <= threshold) ? "depleted" : "available";
}

/** A connection is depleted when every reported usable pool is below the threshold. */
export function isQuotaCollectionDepleted(quotas, threshold = DEPLETED_QUOTA_THRESHOLD) {
  return getQuotaAvailability(quotas, threshold) === "depleted";
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

  return [...connections].sort((a, b) => {
    const aReset = getEarliestQuotaResetTime(quotaData[a.id]?.quotas);
    const bReset = getEarliestQuotaResetTime(quotaData[b.id]?.quotas);
    if (aReset !== bReset) return aReset - bReset;
    if (!Number.isFinite(aReset)) return 0;
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
 * Substitute saved rows for a rate-limited response that carries none.
 *
 * A server restart empties the in-process Claude quota cache, so a dashboard
 * opened during an active 429 cooldown receives `{ message: "Rate limited…" }`
 * with no rows and the card blanks — even though the browser still holds the
 * last-known values.
 *
 * Operates on the POST-parse shape: `setQuotaCache` stores `quotas` as the
 * ARRAY returned by `parseQuotaData`, not the server's object map. Substitutes
 * only when the fresh response has no rows, and only from the same
 * connection's entry, so live data always wins and nothing crosses accounts.
 *
 * @param {string} connectionId connection the rows belong to
 * @param {Array} parsedQuotas rows parsed from the fresh response
 * @param {Object|null} data raw fresh response
 * @returns {{quotas: Array, staleReason: string|null}} rows to render
 */
export function withCachedQuotaFallback(connectionId, parsedQuotas, data) {
  const rows = Array.isArray(parsedQuotas) ? parsedQuotas : [];
  const hasRealRows = rows.some((row) => row && row.name !== "error");
  const message = isObject(data) && isString(data.message) ? data.message : null;
  if (hasRealRows || !message) return { quotas: rows, staleReason: null };

  const cachedRows = getQuotaCache()[connectionId]?.quotas;
  if (!Array.isArray(cachedRows) || cachedRows.length === 0) {
    return { quotas: rows, staleReason: null };
  }

  // Keep the reason visible: these numbers are old and the user must know why.
  return { quotas: cachedRows, staleReason: message };
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

// The one place the quota status thresholds live. QuotaProgressBar, QuotaTable,
// getStatusColor and getStatusEmoji each used to restate `> 70` / `>= 30`.
export const QUOTA_STATUS_HEALTHY_ABOVE = 70;
export const QUOTA_STATUS_WARNING_AT_OR_ABOVE = 30;

/**
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Level: "green" | "yellow" | "red"
 */
export function quotaStatusLevel(percentage) {
  if (percentage > QUOTA_STATUS_HEALTHY_ABOVE) return "green";
  if (percentage >= QUOTA_STATUS_WARNING_AT_OR_ABOVE) return "yellow";
  return "red"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Get Tailwind color class based on percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Color name: "green" | "yellow" | "red"
 */
export function getStatusColor(percentage) {
  return quotaStatusLevel(percentage);
}

const QUOTA_STATUS_EMOJI = { green: "🟢", yellow: "🟡", red: "🔴" };

/**
 * Get status emoji based on percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Emoji: "🟢" | "🟡" | "🔴"
 */
export function getStatusEmoji(percentage) {
  return QUOTA_STATUS_EMOJI[quotaStatusLevel(percentage)];
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
