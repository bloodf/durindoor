import { requestSettings } from "@/store/settingsStore";
import { isBrowser, isObject, isString } from "../../../../../../shared/utils/typeChecks.js";
import {
  CONNECTIONS_PAGE_SIZE,
  ACCOUNT_PAGE_SIZE_MAX,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS } from
"./utils";

export const QUOTA_FILTER_STORAGE_KEY = "quotaTrackerFilterState";
export const QUOTA_FILTER_NAVIGATION_STORAGE_KEY = "quotaTrackerNavigationTarget";
export const FILTER_URL_KEYS = {
  providerFilter: "provider",
  accountFilter: "accountStatus",
  quotaSortMode: "quotaSort",
  expiringFirst: "expiringFirst",
  pageSize: "pageSize",
  page: "page"
};
export const ACCOUNT_FILTER_VALUES = new Set(
  ACCOUNT_FILTER_OPTIONS.map((option) => option.value)
);
export const QUOTA_SORT_VALUES = new Set(
  QUOTA_SORT_OPTIONS.map((option) => option.value)
);
export const DEFAULT_QUOTA_FILTER_STATE = {
  providerFilter: "all",
  accountFilter: "all",
  quotaSortMode: "default",
  expiringFirst: false,
  pageSize: CONNECTIONS_PAGE_SIZE,
  page: 1
};

export function normalizeProviderFilter(value) {
  const normalized = isString(value) ? value.trim() : "";
  return normalized || "all";
}

export function normalizeAccountFilter(value) {
  return ACCOUNT_FILTER_VALUES.has(value) ? value : "all";
}

export function normalizeQuotaSortMode(value) {
  return QUOTA_SORT_VALUES.has(value) ? value : "default";
}

export function normalizeExpiringFirst(value) {
  return value === true || value === "true" || value === "1";
}

export function normalizePageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return CONNECTIONS_PAGE_SIZE;
  return Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsed));
}

export function normalizePage(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

export function normalizeQuotaFilterState(value = {}) {
  return {
    providerFilter: normalizeProviderFilter(value.providerFilter),
    accountFilter: normalizeAccountFilter(value.accountFilter),
    quotaSortMode: normalizeQuotaSortMode(value.quotaSortMode),
    expiringFirst: normalizeExpiringFirst(value.expiringFirst),
    pageSize: normalizePageSize(value.pageSize),
    page: normalizePage(value.page)
  };
}

export function readStoredQuotaFilterState() {
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

export function writeStoredQuotaFilterState(state) {
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

export function hasQuotaFilterSearchParams(searchParams) {
  return Object.values(FILTER_URL_KEYS).some((key) => searchParams.has(key));
}

export function readQuotaFilterValue(searchParams, stateKey, normalize, fallbackValue) {
  const urlKey = FILTER_URL_KEYS[stateKey];
  if (searchParams.has(urlKey)) {
    return normalize(searchParams.get(urlKey));
  }
  return fallbackValue;
}

export function readQuotaFilterState(searchParams, fallbackState = DEFAULT_QUOTA_FILTER_STATE) {
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

export async function writeQuotaFilterState(state) {
  try {
    await requestSettings({
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

export function setSearchParam(params, key, value, defaultValue) {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, String(value));
  }
}

export function buildQuotaFilterSearch(searchParams, state) {
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

export function getCurrentSearchParams(searchParams) {
  return new URLSearchParams(searchParams.toString());
}

export function readPendingQuotaFilterNavigation() {
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

export function isSameFilterState(currentState, nextState) {
  return (
    currentState.providerFilter === nextState.providerFilter &&
    currentState.accountFilter === nextState.accountFilter &&
    currentState.quotaSortMode === nextState.quotaSortMode &&
    currentState.expiringFirst === nextState.expiringFirst &&
    currentState.pageSize === nextState.pageSize &&
    currentState.page === nextState.page);

}
