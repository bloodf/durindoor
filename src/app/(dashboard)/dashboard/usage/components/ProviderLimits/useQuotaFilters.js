import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { requestSettings } from "@/store/settingsStore";
import { ACCOUNT_PAGE_SIZE_OPTIONS, shouldResetPage } from "./utils";
import {
  normalizeProviderFilter,
  normalizeAccountFilter,
  normalizeQuotaSortMode,
  normalizeExpiringFirst,
  normalizePageSize,
  normalizePage,
  normalizeQuotaFilterState,
  readStoredQuotaFilterState,
  writeStoredQuotaFilterState,
  hasQuotaFilterSearchParams,
  readQuotaFilterState,
  writeQuotaFilterState,
  buildQuotaFilterSearch,
  getCurrentSearchParams,
  readPendingQuotaFilterNavigation,
  isSameFilterState } from
"./filterState";

/** Filter, sort and paging controls synced with the URL, localStorage and saved settings. */
export function useQuotaFilters() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilterStateRef = useRef(null);
  if (!initialFilterStateRef.current) {
    initialFilterStateRef.current = readQuotaFilterState(searchParams);
  }
  const initialFilterState = initialFilterStateRef.current;
  const [hasHydratedSavedState, setHasHydratedSavedState] = useState(false);
  const [providerFilter, setProviderFilter] = useState(
    initialFilterState.providerFilter
  );
  const [accountFilter, setAccountFilter] = useState(
    initialFilterState.accountFilter
  );
  const [quotaSortMode, setQuotaSortMode] = useState(
    initialFilterState.quotaSortMode
  );
  const [expiringFirst, setExpiringFirst] = useState(
    initialFilterState.expiringFirst
  );
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [page, setPage] = useState(initialFilterState.page);
  const [pageSize, setPageSize] = useState(initialFilterState.pageSize);
  const [customPageSizeModeState, setCustomPageSizeMode] = useState(
    !ACCOUNT_PAGE_SIZE_OPTIONS.includes(initialFilterState.pageSize)
  );
  const [customPageSizeInput, setCustomPageSizeInput] = useState(
    String(initialFilterState.pageSize)
  );
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
      // Next navigation also respects the Storybook virtual application boundary.
      router.replace(targetUrl, { scroll: false });
    },
    [pathname, searchParams, router]
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
    requestSettings({ cache: "no-store" }).
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

  return {
    initialFilterState,
    hasHydratedSavedState,
    providerFilter,
    accountFilter,
    quotaSortMode,
    expiringFirst,
    page,
    setPage,
    pageSize,
    customPageSizeModeState,
    setCustomPageSizeMode,
    customPageSizeInput,
    setCustomPageSizeInput,
    filterState,
    applyQuotaFilterState,
    updateProviderFilter,
    updateAccountFilter,
    updateQuotaSortMode,
    updateExpiringFirst,
    updatePageSize,
    updatePage
  };
}
