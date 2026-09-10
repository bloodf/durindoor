"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createLatestIntentQueue } from "@/shared/utils/latestIntentQueue";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import Tooltip from "@/shared/ui/components/Tooltip.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import QuotaTable from "./QuotaTable";
import {
  groupConnectionsByProvider,
  mergeAccountQuotas,
  readMergedViewMap,
  writeMergedViewPreference } from
"./grouping";
import {
  parseQuotaData,
  calculatePercentage,
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getQuotaVisibilityKey,
  updateQuotaVisibility,
  getConnectionLabel,
  sortVisibleConnections,
  buildLoadingState,
  getRefreshConnections,
  filterQuotaStateByConnections,
  getConnectionsEmptyMessage,
  getPageSizeLabel,
  getConnectionsPaginationSummary,
  getSafePagination,
  getSafeTotals,
  shouldResetPage,
  getPaginationPageValue,
  getProviderOptions,
  reconcileConnectionsPage,
  getQuotaCache,
  setQuotaCache,
  QUOTA_CACHE_KEY,
  REFRESH_INTERVAL_MS,
  CLAUDE_REFRESH_INTERVAL_MS,
  DEPLETED_QUOTA_THRESHOLD,
  AUTO_REFRESH_STORAGE_KEY,
  CONNECTIONS_PAGE_SIZE,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_PAGE_SIZE_MAX,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS,
  createAutoRefreshScheduler,
  refreshProviderQuotas } from
"./utils";
import { getCodexPlan } from "@/shared/utils/codexPlanLabel";
import { EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Maps the stored providerSpecificData.authMethod to a human label for Kiro.
// Values come from the Kiro connect flows: builder-id/idc (device code),
// google/github (social), imported (refresh-token paste), api_key (headless).
import { isBrowser, isNumber, isObject, isString } from "../../../../../../shared/utils/typeChecks.js";
const KIRO_METHOD_LABELS = {
  "builder-id": "AWS Builder ID",
  idc: "IAM Identity Center",
  google: "Google",
  github: "GitHub",
  imported: "Imported Token",
  api_key: "API Key"
};

const REFRESH_INTERVAL_S = REFRESH_INTERVAL_MS / 1000;

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing"
};

const AUTO_PING_TOOLTIPS = {
  claude: "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
  codex: "Auto-starts the next 5h Codex window after reset by sending a tiny request to an available model. Consumes a small amount of quota."
};

function kiroMethodLabel(conn) {
  const m = conn.providerSpecificData?.authMethod;
  if (m && KIRO_METHOD_LABELS[m]) return KIRO_METHOD_LABELS[m];
  return conn.authType === "api_key" ? "API Key" : "OAuth";
}

function getConnectionSecondaryLabel(connection) {
  if (connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()) {
    return connection.email.trim();
  }

  if (connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()) {
    return connection.displayName.trim();
  }

  return null;
}

// Region is stored for builder-id/idc/api_key flows; social and imported flows
// omit it, so fall back to the region segment of the profileArn
// (arn:aws:codewhisperer:<region>:...).
function kiroRegion(conn) {
  const r = conn.providerSpecificData?.region;
  if (r) return r;
  const arn = conn.providerSpecificData?.profileArn;
  const seg = isString(arn) ? arn.split(":")[3] : "";
  return seg || "";
}

function getCodexResetCreditCount(quota) {
  const value = quota?.raw?.resetCredits?.availableCount;
  const count = isNumber(value) ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

const QUOTA_FILTER_STORAGE_KEY = "quotaTrackerFilterState";
const QUOTA_FILTER_NAVIGATION_STORAGE_KEY = "quotaTrackerNavigationTarget";
const FILTER_URL_KEYS = {
  providerFilter: "provider",
  accountFilter: "accountStatus",
  quotaSortMode: "quotaSort",
  expiringFirst: "expiringFirst",
  pageSize: "pageSize",
  page: "page"
};
const ACCOUNT_FILTER_VALUES = new Set(
  ACCOUNT_FILTER_OPTIONS.map((option) => option.value)
);
const QUOTA_SORT_VALUES = new Set(
  QUOTA_SORT_OPTIONS.map((option) => option.value)
);
const DEFAULT_QUOTA_FILTER_STATE = {
  providerFilter: "all",
  accountFilter: "all",
  quotaSortMode: "default",
  expiringFirst: false,
  pageSize: CONNECTIONS_PAGE_SIZE,
  page: 1
};

function normalizeProviderFilter(value) {
  const normalized = isString(value) ? value.trim() : "";
  return normalized || "all";
}

function normalizeAccountFilter(value) {
  return ACCOUNT_FILTER_VALUES.has(value) ? value : "all";
}

function normalizeQuotaSortMode(value) {
  return QUOTA_SORT_VALUES.has(value) ? value : "default";
}

function normalizeExpiringFirst(value) {
  return value === true || value === "true" || value === "1";
}

function normalizePageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return CONNECTIONS_PAGE_SIZE;
  return Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsed));
}

function normalizePage(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

function normalizeQuotaFilterState(value = {}) {
  return {
    providerFilter: normalizeProviderFilter(value.providerFilter),
    accountFilter: normalizeAccountFilter(value.accountFilter),
    quotaSortMode: normalizeQuotaSortMode(value.quotaSortMode),
    expiringFirst: normalizeExpiringFirst(value.expiringFirst),
    pageSize: normalizePageSize(value.pageSize),
    page: normalizePage(value.page)
  };
}

function readStoredQuotaFilterState() {
  if (!isBrowser()) return null;
  try {
    const stored = window.localStorage.getItem(QUOTA_FILTER_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || !isObject(parsed) || Array.isArray(parsed)) {
      return null;
    }
    return normalizeQuotaFilterState(parsed);
  } catch (error) {
    console.error("Error reading quota filter preference cache:", error);
    return null;
  }
}

function writeStoredQuotaFilterState(state) {
  if (!isBrowser()) return;
  try {
    const normalizedState = normalizeQuotaFilterState(state);
    window.localStorage.setItem(
      QUOTA_FILTER_STORAGE_KEY,
      JSON.stringify(normalizedState)
    );
    window.dispatchEvent(
      new CustomEvent("quotaTrackerFilterStateChange", {
        detail: normalizedState
      })
    );
  } catch (error) {
    console.error("Error writing quota filter preference cache:", error);
  }
}

function hasQuotaFilterSearchParams(searchParams) {
  return Object.values(FILTER_URL_KEYS).some((key) => searchParams.has(key));
}

function readQuotaFilterValue(searchParams, stateKey, normalize, fallbackValue) {
  const urlKey = FILTER_URL_KEYS[stateKey];
  if (searchParams.has(urlKey)) {
    return normalize(searchParams.get(urlKey));
  }
  return fallbackValue;
}

function readQuotaFilterState(searchParams, fallbackState = DEFAULT_QUOTA_FILTER_STATE) {
  const fallback = normalizeQuotaFilterState(fallbackState);
  return {
    providerFilter: readQuotaFilterValue(
      searchParams,
      "providerFilter",
      normalizeProviderFilter,
      fallback.providerFilter
    ),
    accountFilter: readQuotaFilterValue(
      searchParams,
      "accountFilter",
      normalizeAccountFilter,
      fallback.accountFilter
    ),
    quotaSortMode: readQuotaFilterValue(
      searchParams,
      "quotaSortMode",
      normalizeQuotaSortMode,
      fallback.quotaSortMode
    ),
    expiringFirst: readQuotaFilterValue(
      searchParams,
      "expiringFirst",
      normalizeExpiringFirst,
      fallback.expiringFirst
    ),
    pageSize: readQuotaFilterValue(
      searchParams,
      "pageSize",
      normalizePageSize,
      fallback.pageSize
    ),
    page: readQuotaFilterValue(
      searchParams,
      "page",
      normalizePage,
      fallback.page
    )
  };
}

async function writeQuotaFilterState(state) {
  try {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quotaTrackerState: normalizeQuotaFilterState(state)
      })
    });
  } catch (error) {
    console.error("Error writing quota filter preference:", error);
  }
}

function setSearchParam(params, key, value, defaultValue) {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, String(value));
  }
}

function buildQuotaFilterSearch(searchParams, state) {
  const params = new URLSearchParams(searchParams.toString());
  params.delete("stateTs");
  setSearchParam(
    params,
    FILTER_URL_KEYS.providerFilter,
    normalizeProviderFilter(state.providerFilter),
    "all"
  );
  setSearchParam(
    params,
    FILTER_URL_KEYS.accountFilter,
    normalizeAccountFilter(state.accountFilter),
    "all"
  );
  setSearchParam(
    params,
    FILTER_URL_KEYS.quotaSortMode,
    normalizeQuotaSortMode(state.quotaSortMode),
    "default"
  );
  setSearchParam(
    params,
    FILTER_URL_KEYS.expiringFirst,
    normalizeExpiringFirst(state.expiringFirst) ? "1" : "0",
    "0"
  );
  setSearchParam(
    params,
    FILTER_URL_KEYS.pageSize,
    normalizePageSize(state.pageSize),
    CONNECTIONS_PAGE_SIZE
  );
  setSearchParam(
    params,
    FILTER_URL_KEYS.page,
    normalizePage(state.page),
    1
  );
  return params;
}

function getCurrentSearchParams(searchParams) {
  if (!isBrowser()) {
    return new URLSearchParams(searchParams.toString());
  }
  return new URLSearchParams(window.location.search);
}

function readPendingQuotaFilterNavigation() {
  if (!isBrowser()) return null;
  try {
    const target = window.sessionStorage.getItem(
      QUOTA_FILTER_NAVIGATION_STORAGE_KEY
    );
    if (!target) return null;

    window.sessionStorage.removeItem(QUOTA_FILTER_NAVIGATION_STORAGE_KEY);
    const url = new URL(target, window.location.origin);
    if (url.pathname !== window.location.pathname) return null;
    return new URLSearchParams(url.search);
  } catch (error) {
    console.error("Error reading quota navigation target:", error);
    return null;
  }
}

function isSameFilterState(currentState, nextState) {
  return (
    currentState.providerFilter === nextState.providerFilter &&
    currentState.accountFilter === nextState.accountFilter &&
    currentState.quotaSortMode === nextState.quotaSortMode &&
    currentState.expiringFirst === nextState.expiringFirst &&
    currentState.pageSize === nextState.pageSize &&
    currentState.page === nextState.page);

}
function formatCreditDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTimeRemaining(value) {
  if (!value) return "N/A";
  const diffMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "N/A";
  if (diffMs <= 0) return "Expired";
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

export default function ProviderLimits() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialFilterStateRef = useRef(null);
  if (!initialFilterStateRef.current) {
    initialFilterStateRef.current = readQuotaFilterState(searchParams);
  }
  const initialFilterState = initialFilterStateRef.current;
  const [connections, setConnections] = useState([]);
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoPingMaps, setAutoPingMaps] = useState({ claude: {}, codex: {} });
  const [autoPingQueue] = useState(() => createLatestIntentQueue({
    write: async (_key, enabled, { connectionId }) => {
      const response = await fetch(`/api/providers/${encodeURIComponent(connectionId)}/auto-ping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) throw new Error(`Auto-ping update failed (${response.status})`);
      return response.json();
    },
    onOptimistic: (_key, enabled, { connectionId, provider }) => setAutoPingMaps((current) => ({
      ...current,
      [provider]: { ...(current[provider] || {}), [connectionId]: enabled }
    })),
    onConfirmed: (_key, enabled, { connectionId, provider }) => setAutoPingMaps((current) => ({
      ...current,
      [provider]: { ...(current[provider] || {}), [connectionId]: enabled }
    })),
    onRollback: (_key, enabled, { connectionId, provider }) => setAutoPingMaps((current) => ({
      ...current,
      [provider]: { ...(current[provider] || {}), [connectionId]: enabled }
    }))
  }));
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasHydratedSavedState, setHasHydratedSavedState] = useState(false);
  const [hasHydratedAutoRefresh, setHasHydratedAutoRefresh] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [resettingLimitId, setResettingLimitId] = useState(null);
  const [resetConfirmState, setResetConfirmState] = useState(null);
  const [resetCreditsState, setResetCreditsState] = useState(null);
  const [deleteConfirmState, setDeleteConfirmState] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [providerFilter, setProviderFilter] = useState(
    initialFilterState.providerFilter
  );
  const [providerOptions, setProviderOptions] = useState([]);
  const [accountFilter, setAccountFilter] = useState(
    initialFilterState.accountFilter
  );
  const [quotaSortMode, setQuotaSortMode] = useState(
    initialFilterState.quotaSortMode
  );
  const [quotaVisibility, setQuotaVisibility] = useState({});
  const [expiringFirst, setExpiringFirst] = useState(
    initialFilterState.expiringFirst
  );
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [bulkToggling, setBulkToggling] = useState(false);
  const [page, setPage] = useState(initialFilterState.page);
  const [pageSize, setPageSize] = useState(initialFilterState.pageSize);
  const [customPageSizeModeState, setCustomPageSizeMode] = useState(
    !ACCOUNT_PAGE_SIZE_OPTIONS.includes(initialFilterState.pageSize)
  );
  const [customPageSizeInput, setCustomPageSizeInput] = useState(
    String(initialFilterState.pageSize)
  );
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: initialFilterState.pageSize,
    total: 0,
    totalPages: 1
  });
  const [totals, setTotals] = useState({
    eligibleConnections: 0,
    providerFilteredConnections: 0
  });
  // Per-provider merged/per-account view preference (localStorage-backed).
  const [mergedProviders, setMergedProviders] = useState({});

  const { copied, copy } = useCopyToClipboard();
  const schedulerRef = useRef(null);
  const refreshAllRef = useRef(null);
  const tickCountRef = useRef(0);
  const filterStateRef = useRef(initialFilterState);
  const lastPersistedFilterStateRef = useRef(null);
  const lastSyncedQueryRef = useRef(searchParams.toString());
  const hasLocalFilterInteractionRef = useRef(false);
  const hydratingFromUrlRef = useRef(false);

  const filterState = useMemo(
    () => ({
      providerFilter,
      accountFilter,
      quotaSortMode,
      expiringFirst,
      pageSize,
      page
    }),
    [providerFilter, accountFilter, quotaSortMode, expiringFirst, pageSize, page]
  );

  useEffect(() => {
    filterStateRef.current = normalizeQuotaFilterState(filterState);
  }, [filterState]);

  const persistFilterState = useCallback((state) => {
    const normalizedState = normalizeQuotaFilterState(state);
    writeStoredQuotaFilterState(normalizedState);
    if (
    lastPersistedFilterStateRef.current &&
    isSameFilterState(lastPersistedFilterStateRef.current, normalizedState))
    {
      filterStateRef.current = lastPersistedFilterStateRef.current;
      return lastPersistedFilterStateRef.current;
    }
    const nextState = normalizedState;
    lastPersistedFilterStateRef.current = nextState;
    filterStateRef.current = nextState;
    writeQuotaFilterState(nextState);
    return nextState;
  }, []);

  const applyFilterStateToControls = useCallback((state) => {
    const normalizedState = normalizeQuotaFilterState(state);
    filterStateRef.current = normalizedState;
    setProviderFilter(normalizedState.providerFilter);
    setAccountFilter(normalizedState.accountFilter);
    setQuotaSortMode(normalizedState.quotaSortMode);
    setExpiringFirst(normalizedState.expiringFirst);
    setPageSize(normalizedState.pageSize);
    setCustomPageSizeInput(String(normalizedState.pageSize));
    setPage(normalizedState.page);
    return normalizedState;
  }, []);

  const replaceQuotaFilterUrl = useCallback(
    (state) => {
      const params = buildQuotaFilterSearch(
        getCurrentSearchParams(searchParams),
        state
      );
      const query = params.toString();
      lastSyncedQueryRef.current = query;
      const targetUrl = query ? `${pathname}?${query}` : pathname;
      window.history.replaceState(window.history.state, "", targetUrl);
    },
    [pathname, searchParams]
  );

  const applyQuotaFilterState = useCallback(
    (nextState) => {
      hasLocalFilterInteractionRef.current = true;
      const normalizedState = applyFilterStateToControls(nextState);
      persistFilterState(normalizedState);
      replaceQuotaFilterUrl(normalizedState);
      return normalizedState;
    },
    [applyFilterStateToControls, persistFilterState, replaceQuotaFilterUrl]
  );

  useEffect(() => {
    if (hasHydratedSavedState) return;

    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" }).
    then((res) => res.ok ? res.json() : null).
    then((settings) => {
      if (cancelled) return;
      if (hasLocalFilterInteractionRef.current) return;
      const dbFilterState = normalizeQuotaFilterState(
        settings?.quotaTrackerState
      );
      const currentParams = getCurrentSearchParams(searchParams);
      const navigationParams = readPendingQuotaFilterNavigation();
      const sourceParams = navigationParams || currentParams;
      const urlHasFilterState = hasQuotaFilterSearchParams(sourceParams);
      const nextFilterState = urlHasFilterState ?
      readQuotaFilterState(sourceParams) :
      readStoredQuotaFilterState() || dbFilterState;
      const normalizedState = applyFilterStateToControls(nextFilterState);
      if (navigationParams || !urlHasFilterState) {
        replaceQuotaFilterUrl(normalizedState);
      } else {
        lastSyncedQueryRef.current = sourceParams.toString();
      }
    }).
    catch((error) => {
      console.error("Error reading quota filter preference:", error);
    }).
    finally(() => {
      if (!cancelled) setHasHydratedSavedState(true);
    });

    return () => {
      cancelled = true;
    };
  }, [applyFilterStateToControls, hasHydratedSavedState, replaceQuotaFilterUrl, searchParams]);

  useEffect(() => {
    if (!hasHydratedSavedState) return;
    const currentParams = getCurrentSearchParams(searchParams);
    const currentQuery = currentParams.toString();

    if (currentQuery === lastSyncedQueryRef.current) return;

    lastSyncedQueryRef.current = currentQuery;

    if (!hasQuotaFilterSearchParams(currentParams)) {
      const storedFilterState = readStoredQuotaFilterState();
      if (!storedFilterState) return;

      if (!isSameFilterState(filterStateRef.current, storedFilterState)) {
        hydratingFromUrlRef.current = true;
        applyFilterStateToControls(storedFilterState);
      }
      replaceQuotaFilterUrl(storedFilterState);
      return;
    }

    const nextFilterState = readQuotaFilterState(currentParams);
    if (isSameFilterState(filterStateRef.current, nextFilterState)) return;

    hydratingFromUrlRef.current = true;
    applyFilterStateToControls(nextFilterState);
  }, [applyFilterStateToControls, hasHydratedSavedState, replaceQuotaFilterUrl, searchParams]);

  useEffect(() => {
    if (!hasHydratedSavedState) return;

    if (hydratingFromUrlRef.current) {
      hydratingFromUrlRef.current = false;
      persistFilterState(filterState);
      return;
    }

    const persistedFilterState = persistFilterState(filterState);
    const params = buildQuotaFilterSearch(
      getCurrentSearchParams(searchParams),
      persistedFilterState
    );
    const query = params.toString();
    const currentQuery = getCurrentSearchParams(searchParams).toString();
    lastSyncedQueryRef.current = query;

    if (query === currentQuery) return;
    replaceQuotaFilterUrl(persistedFilterState);
  }, [filterState, hasHydratedSavedState, persistFilterState, replaceQuotaFilterUrl, searchParams]);

  const updateProviderFilter = useCallback(
    (nextValue) => {
      const nextFilter = normalizeProviderFilter(nextValue);
      applyQuotaFilterState({
        ...filterState,
        providerFilter: nextFilter,
        page: shouldResetPage(providerFilter, nextFilter) ? 1 : page
      });
      setProviderMenuOpen(false);
    },
    [applyQuotaFilterState, filterState, page, providerFilter]
  );

  const updateAccountFilter = useCallback(
    (nextValue) => {
      const nextFilter = normalizeAccountFilter(nextValue);
      applyQuotaFilterState({
        ...filterState,
        accountFilter: nextFilter,
        page: shouldResetPage(accountFilter, nextFilter) ? 1 : page
      });
    },
    [accountFilter, applyQuotaFilterState, filterState, page]
  );

  const updateQuotaSortMode = useCallback(
    (nextValue) => {
      const nextMode = normalizeQuotaSortMode(nextValue);
      applyQuotaFilterState({
        ...filterState,
        quotaSortMode: nextMode,
        page: shouldResetPage(quotaSortMode, nextMode) ? 1 : page
      });
    },
    [applyQuotaFilterState, filterState, page, quotaSortMode]
  );

  const updateExpiringFirst = useCallback(
    (nextValue) => {
      const nextEnabled = normalizeExpiringFirst(nextValue);
      applyQuotaFilterState({
        ...filterState,
        expiringFirst: nextEnabled,
        page: shouldResetPage(expiringFirst, nextEnabled) ? 1 : page
      });
    },
    [applyQuotaFilterState, expiringFirst, filterState, page]
  );

  const updatePageSize = useCallback(
    (nextValue) => {
      const nextPageSize = normalizePageSize(nextValue);
      applyQuotaFilterState({
        ...filterState,
        pageSize: nextPageSize,
        page: shouldResetPage(pageSize, nextPageSize) ? 1 : page
      });
    },
    [applyQuotaFilterState, filterState, page, pageSize]
  );

  const updatePage = useCallback(
    (nextPage) => {
      applyQuotaFilterState({
        ...filterState,
        page: normalizePage(nextPage)
      });
    },
    [applyQuotaFilterState, filterState]
  );

  const fetchConnections = useCallback(
    async (targetPage = page) => {
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(pageSize),
          accountStatus: accountFilter,
          sort: "priority"
        });

        if (providerFilter !== "all") {
          params.set("provider", providerFilter);
        }

        const response = await fetch(
          `/api/providers/client?${params.toString()}`
        );
        if (!response.ok) throw new Error("Failed to fetch connections");

        const data = await response.json();
        const connectionList = data.connections || [];
        const nextPagination = getSafePagination(data.pagination, pageSize);
        const nextTotals = getSafeTotals(data.totals, connectionList.length);

        setConnections(connectionList);
        setProviderOptions(getProviderOptions(data.providerOptions));
        setPagination(nextPagination);
        setTotals(nextTotals);
        setPage(getPaginationPageValue(data.pagination, targetPage));
        return connectionList;
      } catch (error) {
        console.error("Error fetching connections:", error);
        setConnections([]);
        setProviderOptions([]);
        setPagination({ page: 1, pageSize, total: 0, totalPages: 1 });
        setTotals({ eligibleConnections: 0, providerFilteredConnections: 0 });
        return [];
      }
    },
    [accountFilter, page, pageSize, providerFilter]
  );

  const fetchQuota = useCallback(async (connectionId, provider, { force = false } = {}) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      console.log(
        `[ProviderLimits] Fetching quota for ${provider} (${connectionId})${force ? " (force)" : ""}`
      );
      const url = `/api/usage/${connectionId}${force ? "?force=1" : ""}`;
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(
            `[ProviderLimits] Connection not found for ${provider}, skipping`
          );
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(
            `[ProviderLimits] Auth error for ${provider}:`,
            errorMsg
          );
          const quotaEntry = {
            quotas: [],
            message: errorMsg
          };
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: quotaEntry
          }));
          setQuotaCache(connectionId, quotaEntry);
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      console.log(`[ProviderLimits] Got quota for ${provider}:`, data);

      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data);

      const quotaEntry = {
        quotas: parsedQuotas,
        plan: data.plan || null,
        message: data.message || null,
        raw: data
      };

      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: quotaEntry
      }));
      setQuotaCache(connectionId, quotaEntry);
    } catch (error) {
      console.error(
        `[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`,
        error
      );
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error.message || "Failed to fetch quota"
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Manual refresh bypasses the provider's valid in-process quota cache.
  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider, { force: true });
      setLastUpdated(new Date());
    },
    [fetchQuota]
  );

  const handleResetCodexLimit = useCallback(
    async (connectionId, provider) => {
      if (provider !== "codex" || resettingLimitId) return;

      setResettingLimitId(connectionId);
      setErrors((prev) => ({ ...prev, [connectionId]: null }));

      try {
        const response = await fetch(`/api/usage/${connectionId}/codex-reset-credits`, { method: "POST" });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.message || result.error || result.code || "Failed to reset Codex limit");
        }

        await fetchQuota(connectionId, provider);
        setLastUpdated(new Date());
      } catch (error) {
        setErrors((prev) => ({ ...prev, [connectionId]: error.message || "Failed to reset Codex limit" }));
      } finally {
        setResettingLimitId(null);
      }
    },
    [fetchQuota, resettingLimitId]
  );

  const handleViewCodexResetCredits = useCallback(async (connection) => {
    setResetCreditsState({ connection, loading: true, error: null, data: null });
    try {
      const response = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to load Codex reset credits");
      }
      const credits = Array.isArray(result.credits) ? [...result.credits] : [];
      credits.sort((a, b) => {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
      setResetCreditsState({ connection, loading: false, error: null, data: { ...result, credits } });
    } catch (error) {
      setResetCreditsState({ connection, loading: false, error: error.message || "Failed to load Codex reset credits", data: null });
    }
  }, []);

  const handleDeleteConnection = useCallback(
    async (id) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setLoading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setErrors((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });

          if (isBrowser()) {
            try {
              const cache = getQuotaCache();
              if (cache[id]) {
                delete cache[id];
                window.localStorage.setItem(
                  QUOTA_CACHE_KEY,
                  JSON.stringify(cache)
                );
              }
            } catch (e) {
              console.error("Error deleting cache entry:", e);
            }
          }

          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error deleting connection:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [fetchConnections, page]
  );

  const handleToggleConnectionActive = useCallback(
    async (id, isActive) => {
      setTogglingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive })
        });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            return next;
          });
          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error updating connection status:", error);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchConnections, page]
  );

  const handleUpdateConnection = useCallback(
    async (formData) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const res = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData)
        });
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchConnections, fetchQuota]
  );

  useEffect(() => {
    if (
    providerFilter === "all" ||
    providerOptions.length === 0 ||
    providerOptions.includes(providerFilter))
    {
      return;
    }
    applyQuotaFilterState({ ...filterState, providerFilter: "all", page: 1 });
  }, [applyQuotaFilterState, filterState, providerFilter, providerOptions]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).
    then((res) => res.json()).
    then((data) => {
      if (!cancelled && data?.proxyPools) {
        setProxyPools(data.proxyPools);
      }
    }).
    catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAll = useCallback(async (force = false) => {
    if (refreshingAll) return;

    setRefreshingAll(true);
    setCountdown(REFRESH_INTERVAL_S);

    try {
      // Throttle Claude: poll its quota every Nth auto-tick (manual force bypasses)
      const tick = tickCountRef.current += 1;
      const claudeEvery = Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS);
      const visibleConnections = await fetchConnections(page);
      const refreshConnections = getRefreshConnections(
        visibleConnections,
        force,
        tick,
        claudeEvery
      );

      setLoading(buildLoadingState(refreshConnections));
      setErrors((prev) =>
      filterQuotaStateByConnections(prev, visibleConnections)
      );
      setQuotaData((prev) =>
      filterQuotaStateByConnections(prev, visibleConnections)
      );

      await refreshProviderQuotas(refreshConnections, force, fetchQuota);

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error refreshing all providers:", error);
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshingAll, fetchConnections, fetchQuota, page]);

  // Keep a stable ref to the latest refreshAll so the scheduler effect does not
  // resubscribe on every refreshAll identity change (avoids timer churn).
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    if (!hasHydratedSavedState) return;

    const initializeData = async () => {
      setConnectionsLoading(true);
      const visibleConnections = await fetchConnections(page);
      setConnectionsLoading(false);

      // Always fetch fresh quota on mount, no cache display
      setLoading(buildLoadingState(visibleConnections));
      setErrors((prev) =>
      filterQuotaStateByConnections(prev, visibleConnections)
      );
      setQuotaData((prev) =>
      filterQuotaStateByConnections(prev, visibleConnections)
      );

      await Promise.all(
        visibleConnections.map((conn) => fetchQuota(conn.id, conn.provider))
      );
      setLastUpdated(new Date());
    };

    initializeData();
  }, [fetchConnections, fetchQuota, hasHydratedSavedState, page]);

  useEffect(() => {
    if (!isBrowser()) return;
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    setAutoRefresh(stored === null ? true : stored === "true");
    setHasHydratedAutoRefresh(true);
  }, []);

  // Persist auto-refresh preference
  useEffect(() => {
    if (!isBrowser() || !hasHydratedAutoRefresh) return;
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh, hasHydratedAutoRefresh]);

  // Load auto-ping per-connection maps
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).
    then((r) => r.ok ? r.json() : {}).
    then((s) => {
      const maps = {
        claude: s?.claudeAutoPing?.connections || {},
        codex: s?.codexAutoPing?.connections || {}
      };
      autoPingQueue.hydrate(Object.entries(maps).flatMap(([provider, connectionsMap]) =>
      Object.entries(connectionsMap).map(([id, enabled]) => [`${provider}:${id}`, enabled])
      ));
      setAutoPingMaps(maps);
      setQuotaVisibility(s?.quotaVisibility || {});
    }).
    catch(() => {});
  }, [autoPingQueue]);

  const toggleAutoPing = useCallback(async (connectionId, provider, on) => {
    const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
    if (!settingsKey) return;
    await autoPingQueue.enqueue(`${provider}:${connectionId}`, on, { connectionId, provider });
  }, [autoPingQueue]);

  const pendingWrites = useRef([]);
  const isProcessingWrites = useRef(false);
  const quotaVisibilityRef = useRef(quotaVisibility);
  useEffect(() => {
    quotaVisibilityRef.current = quotaVisibility;
  }, [quotaVisibility]);

  const processQueue = useCallback(async () => {
    if (isProcessingWrites.current) return;
    isProcessingWrites.current = true;
    try {
      while (pendingWrites.current.length > 0) {
        const batch = pendingWrites.current.splice(0);
        const startState = quotaVisibilityRef.current;
        const nextState = batch.reduce((state, mutate) => mutate(state), startState);
        setQuotaVisibility(nextState);
        quotaVisibilityRef.current = nextState;
        try {
          const response = await fetch("/api/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quotaVisibility: nextState })
          });
          if (!response.ok) throw new Error("Failed to update quota visibility");
        } catch (error) {
          console.error("Error updating quota visibility:", error);
          setQuotaVisibility(startState);
          quotaVisibilityRef.current = startState;
        }
      }
    } finally {
      isProcessingWrites.current = false;
    }
  }, []);

  const handleHideQuota = useCallback((connectionId, provider, quota) => {
    const key = getQuotaVisibilityKey(quota, quota.visibilityIndex);
    if (!connectionId || !key) return;

    // Family-key pruning for Antigravity ("gemini"/"claude") lives inside
    // updateQuotaVisibility (utils.js), which each queued mutation applies.
    pendingWrites.current.push((state) =>
    updateQuotaVisibility(state, connectionId, provider, key, true)
    );
    processQueue();
  }, [processQueue]);
  const handleShowQuota = useCallback((connectionId, provider, quota) => {
    const key = getQuotaVisibilityKey(quota, quota.visibilityIndex);
    if (!connectionId || !key) return;

    pendingWrites.current.push((state) =>
    updateQuotaVisibility(state, connectionId, provider, key, false)
    );
    processQueue();
  }, [processQueue]);

  // One scheduler owns refresh + countdown timers and pauses on tab-hidden,
  // deriving the countdown from an absolute deadline so buffered tunnels stay
  // stable across visibility changes. Replaces the prior dual-setInterval logic.
  useEffect(() => {
    if (!hasHydratedAutoRefresh || !autoRefresh) {
      schedulerRef.current?.stop();
      schedulerRef.current = null;
      setCountdown(Math.ceil(REFRESH_INTERVAL_MS / 1000));
      return;
    }

    const scheduler = createAutoRefreshScheduler({
      intervalMs: REFRESH_INTERVAL_MS,
      onRefresh: (force) => refreshAllRef.current?.(force),
      onCountdown: setCountdown
    });
    schedulerRef.current = scheduler;
    scheduler.start();

    const handleVisibilityChange = () => {
      if (document.hidden) scheduler.pause();else
      void scheduler.resume();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [autoRefresh, hasHydratedAutoRefresh]);

  // Hydrate per-provider merged-view preferences from localStorage (client-only).
  useEffect(() => {
    setMergedProviders(readMergedViewMap());
  }, []);

  const toggleMergedView = useCallback((provider, merged) => {
    setMergedProviders((prev) => {
      const next = { ...prev };
      if (merged) next[provider] = true;else delete next[provider];
      return next;
    });
    writeMergedViewPreference(provider, merged);
  }, []);

  const sortedConnections = useMemo(
    () =>
    sortVisibleConnections(
      connections,
      quotaData,
      expiringFirst,
      providerFilter,
      quotaSortMode
    ),
    [connections, quotaData, expiringFirst, providerFilter, quotaSortMode]
  );

  const connectionQuotaRows = useMemo(() => {
    const rows = {};
    for (const conn of sortedConnections) {
      const rawQuotas = quotaData[conn.id]?.quotas || [];
      const visibleQuotas = filterQuotasByVisibility(
        conn.id,
        rawQuotas,
        quotaVisibility,
        conn.provider
      ).map((quota) => ({
        ...quota,
        visibilityIndex: rawQuotas.indexOf(quota)
      }));
      const hiddenQuotaRows = getHiddenQuotaRows(
        conn.id,
        rawQuotas,
        quotaVisibility,
        conn.provider
      ).map((quota) => ({
        ...quota,
        visibilityIndex: rawQuotas.indexOf(quota)
      }));
      rows[conn.id] = { rawQuotas, visibleQuotas, hiddenQuotaRows };
    }
    return rows;
  }, [sortedConnections, quotaData, quotaVisibility]);

  // One card per provider; account order inside a group follows the visible sort.
  const providerGroups = useMemo(
    () => groupConnectionsByProvider(sortedConnections),
    [sortedConnections]
  );

  // Connection is depleted when any quota entry hit the threshold
  const isConnectionDepleted = (conn) => {
    const quotas = quotaData[conn.id]?.quotas;
    if (!quotas?.length) return false;
    return quotas.some((q) => {
      if (!q.total || q.total <= 0) return false;
      return calculatePercentage(q.used, q.total) <= DEPLETED_QUOTA_THRESHOLD;
    });
  };

  const bulkSetActive = useCallback(
    async (targetIds, isActive) => {
      if (!targetIds.length || bulkToggling) return;
      setBulkToggling(true);
      try {
        await Promise.all(
          targetIds.map((id) =>
          fetch(`/api/providers/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive })
          })
          )
        );
        await reconcileConnectionsPage(fetchConnections, page);
      } catch (error) {
        console.error("Error bulk toggling connections:", error);
      } finally {
        setBulkToggling(false);
      }
    },
    [bulkToggling, fetchConnections, page]
  );

  const handleDisableDepleted = () => {
    const ids = sortedConnections.
    filter((c) => (c.isActive ?? true) && isConnectionDepleted(c)).
    map((c) => c.id);
    bulkSetActive(ids, false);
  };

  const handleEnableAvailable = () => {
    const ids = sortedConnections.
    filter((c) => !(c.isActive ?? true) && !isConnectionDepleted(c)).
    map((c) => c.id);
    bulkSetActive(ids, true);
  };

  const hasEligibleConnections = totals.eligibleConnections > 0;
  const hasVisibleConnections = sortedConnections.length > 0;
  const emptyState = getConnectionsEmptyMessage(
    totals,
    providerFilter,
    accountFilter
  );
  const connectionsPageSummary = getConnectionsPaginationSummary(pagination);
  const isCustomPageSize = !ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize);
  const customPageSizeMode = customPageSizeModeState || isCustomPageSize;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            aria-label="Filter quota providers"
            value={providerFilter}
            onChange={updateProviderFilter}
            options={[
              { value: "all", label: "All providers", icon: <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-muted">apps</span> },
              ...providerOptions.map((provider) => ({
                value: provider,
                label: provider,
                icon: <ProviderLogo provider={provider} size={20} />,
              })),
            ]}
          />
          <Select
            aria-label="Filter accounts by status"
            className="min-w-[8rem]"
            value={accountFilter}
            onChange={updateAccountFilter}
            options={ACCOUNT_FILTER_OPTIONS}
          />
          {providerFilter === "codex" ? (
            <Select
              aria-label="Sort Codex quotas by remaining"
              className="min-w-[10rem]"
              value={quotaSortMode}
              onChange={updateQuotaSortMode}
              options={QUOTA_SORT_OPTIONS}
            />
          ) : null}
          <Button variant="secondary" size="sm" icon="hourglass_top" onClick={() => updateExpiringFirst(!expiringFirst)} className={expiringFirst ? "ring-1 ring-dd-warning" : ""}>
            <span className="hidden sm:inline">Expiring first</span>
          </Button>
          <Button variant="danger" size="sm" icon="block" onClick={handleDisableDepleted} disabled={bulkToggling}>
            <span className="hidden sm:inline">Turn off Empty</span>
            <span className="sm:hidden">Off</span>
          </Button>
          <Button variant="primary" size="sm" icon="check_circle" onClick={handleEnableAvailable} disabled={bulkToggling}>
            <span className="hidden sm:inline">Turn on Available</span>
            <span className="sm:hidden">On</span>
          </Button>
          <Button variant="secondary" size="sm" icon={autoRefresh ? "toggle_on" : "toggle_off"} onClick={() => setAutoRefresh((prev) => !prev)}>
            <span className="hidden sm:inline">Auto-refresh</span>
            {autoRefresh ? <span className="text-[10px] text-dd-muted dd-tnum">({countdown}s)</span> : null}
          </Button>
          <IconButton
            label="Refresh all"
            icon={refreshingAll ? "progress_activity" : "refresh"}
            onClick={() => {
              if (autoRefresh && schedulerRef.current) void schedulerRef.current.refreshNow();
              else void refreshAll(true);
            }}
            disabled={refreshingAll}
            className={refreshingAll ? "[&_span]:animate-spin" : ""}
          />
        </div>
      </div>
      {expiringFirst ? <div className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-3 py-2 text-xs text-dd-warning">Expiring-first currently reorders accounts inside current page. Cross-page ordering still follows backend pagination.</div> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy={connectionsLoading || undefined}>
        {connectionsLoading ? <Card className="md:col-span-2"><div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>Loading provider limits...</div></Card> : hasVisibleConnections ? providerGroups.map((group) => {
          const isGrouped = group.connections.length > 1;
          const isMerged = isGrouped && mergedProviders[group.provider] === true;
          const isCodexGroup = group.provider === "codex";

          const renderAccountSection = (conn, sectionIndex) => {
            const quota = quotaData[conn.id];
            const isLoading = loading[conn.id];
            const error = errors[conn.id];
            const isInactive = conn.isActive === false;
            const isCodex = conn.provider === "codex";
            const codexPlan = isCodex ? getCodexPlan(quota, conn) : "";
            const resetCreditCount = getCodexResetCreditCount(quota);
            const isResettingLimit = resettingLimitId === conn.id;
            const rowBusy = deletingId === conn.id || togglingId === conn.id || isResettingLimit;
            const { visibleQuotas, hiddenQuotaRows } = connectionQuotaRows[conn.id] || { visibleQuotas: [], hiddenQuotaRows: [] };
            const testStatus = isInactive ? "disabled" : conn.testStatus || "unknown";
            const testStatusTone = isInactive ? "neutral" : conn.testStatus === "active" || conn.testStatus === "success" ? "success" : conn.testStatus === "error" || conn.testStatus === "expired" || conn.testStatus === "unavailable" ? "danger" : "neutral";
            const secondaryLabel = getConnectionSecondaryLabel(conn);

            return <section key={conn.id} aria-label={getConnectionLabel(conn) || conn.id} className={[sectionIndex > 0 ? "border-t border-dd-border-subtle" : "", isInactive ? "opacity-60" : "", "flex flex-col gap-3 p-3"].filter(Boolean).join(" ")}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-dd-text">{getConnectionLabel(conn)}</span>
                  {secondaryLabel ? <span className="truncate text-xs text-dd-muted">{secondaryLabel}</span> : null}
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {isCodex && codexPlan ? <Badge tone="accent" size="sm" className="capitalize">{codexPlan}</Badge> : null}
                  {isCodex ? <>
                    <Tooltip content={resetCreditCount > 0 ? `Use one Codex reset credit. Available: ${resetCreditCount}` : "No Codex reset credits available"}><Button variant="secondary" size="sm" icon={isResettingLimit ? "progress_activity" : "restart_alt"} onClick={() => setResetConfirmState({ connection: conn, resetCreditCount })} disabled={resetCreditCount <= 0 || isLoading || rowBusy} className={isResettingLimit ? "[&_span]:animate-spin dd-tnum" : "dd-tnum"} aria-label={resetCreditCount > 0 ? `Use one Codex reset credit. ${resetCreditCount} available.` : "No Codex reset credits available"}>{resetCreditCount}</Button></Tooltip>
                    <Tooltip content="View Codex reset credit expiry"><IconButton label="View Codex reset credit expiry" icon="schedule" onClick={() => handleViewCodexResetCredits(conn)} disabled={isLoading || rowBusy} /></Tooltip>
                  </> : null}
                  {AUTO_PING_SETTINGS_KEYS[conn.provider] && conn.authType === "oauth" && !isInactive ? <Tooltip content={AUTO_PING_TOOLTIPS[conn.provider]}><IconButton label="Toggle auto-ping" icon="bolt" onClick={() => toggleAutoPing(conn.id, conn.provider, autoPingMaps[conn.provider]?.[conn.id] !== true)} className={autoPingMaps[conn.provider]?.[conn.id] === true ? "text-dd-accent" : ""} /></Tooltip> : null}
                  <Tooltip content="Refresh quota"><IconButton label="Refresh quota" icon={isLoading ? "progress_activity" : "refresh"} onClick={() => refreshProvider(conn.id, conn.provider)} disabled={isLoading || rowBusy} className={isLoading ? "[&_span]:animate-spin" : ""} /></Tooltip>
                  <Tooltip content="Edit connection"><IconButton label="Edit connection" icon="edit" onClick={() => { setSelectedConnection(conn); setShowEditModal(true); }} disabled={rowBusy} /></Tooltip>
                  <Tooltip content="Delete connection"><IconButton label="Delete connection" icon="delete" onClick={() => setDeleteConfirmState(conn)} disabled={rowBusy} className="text-dd-danger hover:text-dd-danger" /></Tooltip>
                  <Toggle checked={conn.isActive ?? true} disabled={rowBusy} aria-label={conn.isActive ?? true ? "Disable connection" : "Enable connection"} onChange={(nextActive) => handleToggleConnectionActive(conn.id, nextActive)} />
                </span>
              </div>
              {conn.provider === "kiro" ? <div className="flex flex-wrap items-center gap-1"><Badge tone="accent" size="sm">{kiroMethodLabel(conn)}</Badge>{kiroRegion(conn) ? <Badge tone="info" size="sm">{kiroRegion(conn)}</Badge> : null}<Badge tone={testStatusTone} size="sm">{testStatus}</Badge>{conn.providerSpecificData?.profileArn ? <Button variant="ghost" size="sm" icon={copied === conn.id ? "check" : "content_copy"} onClick={() => copy(conn.providerSpecificData.profileArn, conn.id)} title={conn.providerSpecificData.profileArn} className="max-w-full justify-start px-2 font-mono text-[11px]"><span className="truncate">{conn.providerSpecificData.profileArn}</span></Button> : null}</div> : null}
              {isLoading ? <div className="flex justify-center py-5 text-dd-muted"><span role="status" aria-label="Loading quota" className="material-symbols-outlined animate-spin text-[28px]">progress_activity</span></div> : error ? <div role="alert" className="rounded-dd border border-dd-danger bg-dd-danger/10 p-3 text-[13px] text-dd-danger">{error}</div> : quota?.message ? <div className="rounded-dd border border-dd-info bg-dd-info/10 p-3 text-[13px] text-dd-info">{quota.message}</div> : <QuotaTable quotas={visibleQuotas} compact sortMode={isCodex ? quotaSortMode : "default"} showSortLabel={isCodex && quotaSortMode !== "default"} onHideQuota={(quotaRow) => handleHideQuota(conn.id, conn.provider, quotaRow)} />}
              {hiddenQuotaRows.length > 0 ? <div className="flex flex-wrap items-center gap-1 border-t border-dd-border-subtle pt-2 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined text-[14px]">visibility_off</span><span>Hidden:</span>{hiddenQuotaRows.map((quotaRow) => <Button key={getQuotaVisibilityKey(quotaRow, quotaRow.visibilityIndex)} variant="secondary" size="sm" onClick={() => handleShowQuota(conn.id, conn.provider, quotaRow)} title="Show this quota row">{quotaRow.name}</Button>)}</div> : null}
            </section>;
          };

          const mergedQuotas = isMerged ?
          mergeAccountQuotas(group.connections.map((conn) => ({
            connectionId: conn.id,
            quotas: connectionQuotaRows[conn.id]?.visibleQuotas || []
          }))) :
          [];
          const anyAccountLoading = group.connections.some((conn) => loading[conn.id]);

          return <Card key={group.provider || group.connections[0]?.id} padding={false} className="min-w-0">
            <CardHeader
              title={<span className="inline-flex min-w-0 items-center gap-2"><ProviderLogo provider={group.provider} size={32} /><span className="truncate capitalize">{group.provider}</span></span>}
              subtitle={isGrouped ? `${group.connections.length} accounts` : null}
              actions={isGrouped ? <Tooltip content="Merge identical quotas across accounts"><span className="flex items-center gap-1.5 text-xs text-dd-muted">Merged<Toggle size="sm" checked={isMerged} aria-label={`Merge ${group.provider} quotas across accounts`} onChange={(nextMerged) => toggleMergedView(group.provider, nextMerged)} /></span></Tooltip> : null}
            />
            <div className="flex flex-col">
              {isMerged ? <div className="flex flex-col gap-3 p-3">
                {group.connections.map((conn) => {
                  const error = errors[conn.id];
                  const message = quotaData[conn.id]?.message;
                  const accountLabel = getConnectionLabel(conn);
                  const { hiddenQuotaRows } = connectionQuotaRows[conn.id] || { hiddenQuotaRows: [] };
                  return <div key={conn.id} className="flex flex-col gap-2">
                    {error ? <div role="alert" className="rounded-dd border border-dd-danger bg-dd-danger/10 p-3 text-[13px] text-dd-danger"><span className="font-medium">{accountLabel}:</span> {error}</div> : message ? <div className="rounded-dd border border-dd-info bg-dd-info/10 p-3 text-[13px] text-dd-info"><span className="font-medium">{accountLabel}:</span> {message}</div> : null}
                    {hiddenQuotaRows.length > 0 ? <div className="flex flex-wrap items-center gap-1 text-xs text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined text-[14px]">visibility_off</span><span>Hidden ({accountLabel}):</span>{hiddenQuotaRows.map((quotaRow) => <Button key={getQuotaVisibilityKey(quotaRow, quotaRow.visibilityIndex)} variant="secondary" size="sm" onClick={() => handleShowQuota(conn.id, conn.provider, quotaRow)} title="Show this quota row">{quotaRow.name}</Button>)}</div> : null}
                  </div>;
                })}
                {anyAccountLoading && mergedQuotas.length === 0 ? <div className="flex justify-center py-5 text-dd-muted"><span role="status" aria-label="Loading quota" className="material-symbols-outlined animate-spin text-[28px]">progress_activity</span></div> : null}
                {mergedQuotas.length > 0 ? <QuotaTable quotas={mergedQuotas} compact sortMode={isCodexGroup ? quotaSortMode : "default"} showSortLabel={isCodexGroup && quotaSortMode !== "default"} /> : null}
              </div> : group.connections.map((conn, sectionIndex) => renderAccountSection(conn, sectionIndex))}
            </div>
          </Card>;
        }) : <div className="md:col-span-2"><Card><EmptyState icon={emptyState.icon} title={emptyState.title} message={emptyState.description} /></Card></div>}
      </div>
      <Card padding={false}>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-xs text-dd-muted">{connectionsPageSummary}</span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Select
              aria-label="Accounts per page"
              value={customPageSizeMode ? "custom" : String(pageSize)}
              onChange={(nextValue) => {
                if (nextValue === "custom") { setCustomPageSizeMode(true); return; }
                setCustomPageSizeMode(false);
                updatePageSize(nextValue);
              }}
              options={[...ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => ({ value: String(option), label: `${option} / page` })), { value: "custom", label: "Custom" }]}
            />
            {customPageSizeMode ? <Input
              type="number"
              min="1"
              max={ACCOUNT_PAGE_SIZE_MAX}
              inputMode="numeric"
              value={customPageSizeInput}
              onChange={(event) => setCustomPageSizeInput(event.target.value)}
              onBlur={() => updatePageSize(customPageSizeInput)}
              onKeyDown={(event) => { if (event.key === "Enter") updatePageSize(customPageSizeInput); }}
              aria-label="Custom accounts per page"
              className="w-24"
            /> : null}
          </div>
          <Pagination
            page={pagination.page}
            pageCount={pagination.totalPages}
            total={pagination.total}
            rowsLabel={`Page ${pagination.page} / ${pagination.totalPages}`}
            onPage={updatePage}
          />
        </CardContent>
      </Card>

      <ConfirmDialog open={Boolean(resetConfirmState)} onCancel={() => { if (!resettingLimitId) setResetConfirmState(null); }} onConfirm={async () => { const connection = resetConfirmState?.connection; if (!connection) return; await handleResetCodexLimit(connection.id, connection.provider); setResetConfirmState(null); }} title="Reset Codex limit?" message={`Use 1 Codex reset credit for ${getConnectionLabel(resetConfirmState?.connection || {}) || "this account"}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`} confirmLabel="Reset limit" cancelLabel="Cancel" tone="danger" pending={Boolean(resettingLimitId)} />
      <ConfirmDialog open={Boolean(deleteConfirmState)} onCancel={() => { if (!deletingId) setDeleteConfirmState(null); }} onConfirm={async () => { const connection = deleteConfirmState; if (!connection) return; await handleDeleteConnection(connection.id); setDeleteConfirmState(null); }} title="Delete connection?" message={`Delete ${getConnectionLabel(deleteConfirmState || {}) || "this connection"}? This cannot be undone.`} confirmLabel="Delete connection" cancelLabel="Cancel" tone="danger" pending={Boolean(deletingId)} />

      <Modal open={Boolean(resetCreditsState)} onClose={() => setResetCreditsState(null)} title="Codex Reset Credit Expiry" subtitle={resetCreditsState ? getConnectionLabel(resetCreditsState.connection) : "Codex account"} size="xl" pending={Boolean(resetCreditsState?.loading)}>{resetCreditsState?.loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>Loading reset credits...</div> : resetCreditsState?.error ? <div role="alert" className="rounded-dd border border-dd-danger bg-dd-danger/10 p-3 text-sm text-dd-danger">{resetCreditsState.error}</div> : resetCreditsState?.data?.credits?.length ? <div className="space-y-3"><div className="flex justify-between rounded-dd bg-dd-surface-2 px-3 py-2 text-xs text-dd-muted"><span>{resetCreditsState.data.credits.length} reset credit{resetCreditsState.data.credits.length === 1 ? "" : "s"}</span><span>{resetCreditsState.data.availableCount ?? 0} available</span></div><DataTable framed={false} ariaLabel="Codex reset credit expiry" density="compact" rows={resetCreditsState.data.credits} keyFn={(credit, index) => `${credit.status}-${credit.expiresAt || index}`} columns={[{ key: "status", label: "Status", render: (credit) => <Badge tone="accent" size="sm">{credit.status || "unknown"}</Badge> }, { key: "grantedAt", label: "Granted at", render: (credit) => formatCreditDate(credit.grantedAt) }, { key: "expiresAt", label: "Expires at", render: (credit) => formatCreditDate(credit.expiresAt) }, { key: "remaining", label: "Remaining", render: (credit) => formatTimeRemaining(credit.expiresAt) }]} /></div> : <EmptyState icon="event_busy" title="No reset credit details returned" />}</Modal>

      <EditConnectionModal isOpen={showEditModal} connection={selectedConnection} proxyPools={proxyPools} onSave={handleUpdateConnection} onClose={() => { setShowEditModal(false); setSelectedConnection(null); }} />
    </div>);
}
