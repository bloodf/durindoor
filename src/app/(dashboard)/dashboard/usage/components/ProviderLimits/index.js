"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import {
  groupConnectionsByProvider,
  isCustomNodeId,
  providerNodeLabels,
  readMergedViewMap,
  writeMergedViewPreference } from
"./grouping";
import {
  getEarliestQuotaResetTime,
  getQuotaAvailability,
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getConnectionLabel,
  sortVisibleConnections,
  buildLoadingState,
  getRefreshConnections,
  filterQuotaStateByConnections,
  getConnectionsEmptyMessage,
  getConnectionsPaginationSummary,
  getSafePagination,
  getSafeTotals,
  getPaginationPageValue,
  getProviderOptions,
  reconcileConnectionsPage,
  REFRESH_INTERVAL_MS,
  CLAUDE_REFRESH_INTERVAL_MS,
  DEPLETED_QUOTA_THRESHOLD,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS,
  refreshProviderQuotas } from
"./utils";
import { EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { getClaudeWeeklyWindowNames, withClaudeWeeklyPlaceholders } from "./claudeQuotaRows";
import { formatClaudeResetClears, formatCreditDate } from "./connectionDisplay";
import ProviderGroupCard from "./ProviderGroupCard";
import ConnectionsPager from "./ConnectionsPager";
import ResetCreditsModal from "./ResetCreditsModal";
import { useQuotaFilters } from "./useQuotaFilters";
import { useQuotaData } from "./useQuotaData";
import { useConnectionActions } from "./useConnectionActions";
import { useQuotaVisibility } from "./useQuotaVisibility";
import { useAutoPing } from "./useAutoPing";
import { REFRESH_INTERVAL_S, useAutoRefresh } from "./useAutoRefresh";

export default function ProviderLimits() {
  const uiV5 = useUiV5();
  const {
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
  } = useQuotaFilters();
  const { quotaVisibility, setQuotaVisibility, handleHideQuota, handleShowQuota } = useQuotaVisibility();
  const [connections, setConnections] = useState([]);
  const [providerOrder, setProviderOrder] = useState([]);
  const [orderPending, setOrderPending] = useState(false);
  const [orderError, setOrderError] = useState("");
  const draggedProvider = useRef(null);
  const [keyboardProvider, setKeyboardProvider] = useState(null);
  const [connectionsError, setConnectionsError] = useState("");
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const connectionsSnapshot = useRef([]);
  const connectionsRequest = useRef(0);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [resetConfirmState, setResetConfirmState] = useState(null);
  const [deleteConfirmState, setDeleteConfirmState] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [providerOptions, setProviderOptions] = useState([]);
  const [nodeLabels, setNodeLabels] = useState({});
  const hasCustomProvider = providerOptions.some(isCustomNodeId);
  useEffect(() => {
    if (!hasCustomProvider) return;
    let alive = true;
    fetch("/api/provider-nodes").
    then((response) => response.ok ? response.json() : null).
    then((data) => { if (alive && data) setNodeLabels(providerNodeLabels(data.nodes)); }).
    catch(() => {/* headings fall back to the provider id */});
    return () => { alive = false; };
  }, [hasCustomProvider]);
  const [bulkToggling, setBulkToggling] = useState(false);
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
  const refreshAllRef = useRef(null);
  const tickCountRef = useRef(0);
  const { autoRefresh, setAutoRefresh, countdown, setCountdown, schedulerRef } = useAutoRefresh(refreshAllRef);

  const fetchConnections = useCallback(
    async (targetPage = page) => {
      const epoch = ++connectionsRequest.current;
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(pageSize),
          accountStatus: accountFilter,
          sort: expiringFirst ? "expiring" : "priority"
        });

        if (providerFilter !== "all") {
          params.set("provider", providerFilter);
        }

        const response = await fetch(
          `/api/providers/client?${params.toString()}`
        );
        if (!response.ok) throw new Error("Failed to fetch connections");

        const data = await response.json();
        if (epoch !== connectionsRequest.current) return connectionsSnapshot.current;
        const connectionList = data.connections || [];
        connectionsSnapshot.current = connectionList;
        setConnectionsError("");
        setConnectionsLoaded(true);
        const nextPagination = getSafePagination(data.pagination, pageSize);
        const nextTotals = getSafeTotals(data.totals, connectionList.length);

        setConnections(connectionList);
        setProviderOrder(data.providerOrder || []);
        setProviderOptions(getProviderOptions(data.providerOptions));
        setPagination(nextPagination);
        setTotals(nextTotals);
        setPage(getPaginationPageValue(data.pagination, targetPage));
        return connectionList;
      } catch (error) {
        if (epoch === connectionsRequest.current) setConnectionsError(error.message || "Connection list unavailable");
        // A failed refresh is not a successful empty list.
        return connectionsSnapshot.current;
      }
    },
    [accountFilter, expiringFirst, page, pageSize, providerFilter, setPage]
  );

  const moveProvider = useCallback(async (provider, target) => {
    if (!target || provider === target || orderPending) return;
    setOrderPending(true);
    setOrderError("");
    try {
      const response = await fetch("/api/settings/quota-provider-order", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, target })
      });
      if (!response.ok) throw new Error("Could not save provider order. Try again.");
      await fetchConnections();
    } catch (error) {
      setOrderError(error.message || "Could not save provider order. Try again.");
    } finally { setOrderPending(false); }
  }, [fetchConnections, orderPending]);

  const {
    quotaData,
    setQuotaData,
    loading,
    setLoading,
    errors,
    setErrors,
    lastUpdated,
    setLastUpdated,
    fetchQuota,
    refreshProvider
  } = useQuotaData(uiV5);


  const {
    deletingId,
    togglingId,
    resettingLimitId,
    refreshingTokenId,
    resetCreditsState,
    setResetCreditsState,
    handleResetLimit,
    handleViewCodexResetCredits,
    handleViewClaudeResets,
    handleDeleteConnection,
    handleToggleConnectionActive,
    handleRefreshToken,
    handleUltrafast
  } = useConnectionActions({
    fetchConnections,
    fetchQuota,
    refreshProvider,
    page,
    setQuotaData,
    setLoading,
    setErrors,
    setLastUpdated,
    setConnectionsError
  });

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
        // Reject failures so the edit modal can preserve the draft and offer retry.
        if (!res.ok) throw new Error("Failed to save connection");
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        throw error;
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
  }, [refreshingAll, fetchConnections, fetchQuota, page, setCountdown, setErrors, setLastUpdated, setLoading, setQuotaData]);

  // Keep a stable ref to the latest refreshAll so the scheduler effect does not
  // resubscribe on every refreshAll identity change (avoids timer churn).
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    if (!hasHydratedSavedState) return;

    let active = true;
    const initializeData = async () => {
      setConnectionsLoading(true);
      const visibleConnections = await fetchConnections(page);
      if (!active) return;
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
    const initialRequestEpoch = connectionsRequest.current;
    return () => {
      active = false;
      // Do not cancel a newer refresh that this effect did not start.
      if (connectionsRequest.current === initialRequestEpoch) {
        connectionsRequest.current = initialRequestEpoch + 1;
      }
    };
  }, [fetchConnections, fetchQuota, hasHydratedSavedState, page, setErrors, setLastUpdated, setLoading, setQuotaData]);

  const { autoPingMaps, toggleAutoPing } = useAutoPing(setQuotaVisibility);



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
    const claudeWeeklyWindows = getClaudeWeeklyWindowNames(sortedConnections, quotaData);
    for (const conn of sortedConnections) {
      const rawQuotas = quotaData[conn.id]?.quotas || [];
      let visibleQuotas = filterQuotasByVisibility(
        conn.id,
        rawQuotas,
        quotaVisibility,
        conn.provider
      ).map((quota) => ({
        ...quota,
        visibilityIndex: rawQuotas.indexOf(quota)
      }));
      if (conn.provider === "claude") {
        visibleQuotas = withClaudeWeeklyPlaceholders(visibleQuotas, rawQuotas, claudeWeeklyWindows);
      }
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

  // Exclude accounts without measured quota from bulk enable/disable actions (#5898).
  const depletedIds = sortedConnections
    .filter((conn) => (conn.isActive ?? true) && getQuotaAvailability(quotaData[conn.id]?.quotas, DEPLETED_QUOTA_THRESHOLD) === "depleted")
    .map((conn) => conn.id);
  const availableIds = sortedConnections
    .filter((conn) => !(conn.isActive ?? true) && getQuotaAvailability(quotaData[conn.id]?.quotas, DEPLETED_QUOTA_THRESHOLD) === "available")
    .map((conn) => conn.id);
  const hasQuotaReset = sortedConnections.some((conn) => Number.isFinite(getEarliestQuotaResetTime(quotaData[conn.id]?.quotas)));

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
      <div className="flex flex-wrap items-center gap-1.5">
          <Select
            aria-label="Filter quota providers"
            fullWidth={false}
            className="w-[8.25rem] max-w-full flex-auto sm:flex-none"
            value={providerFilter}
            onChange={updateProviderFilter}
            options={[
              { value: "all", label: "All providers", icon: <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-dd-muted">apps</span> },
              ...providerOptions.map((provider) => ({
                value: provider,
                label: nodeLabels[provider] || provider,
                icon: <ProviderLogo provider={provider} size={20} />,
              })),
            ]}
          />
          <Select
            aria-label="Filter accounts by status"
            fullWidth={false}
            className="w-32 max-w-full flex-auto sm:flex-none"
            value={accountFilter}
            onChange={updateAccountFilter}
            options={ACCOUNT_FILTER_OPTIONS}
          />
          {providerFilter === "codex" ? (
            <Select
              aria-label="Sort Codex quotas by remaining"
              fullWidth={false}
              className="w-[9.5rem] max-w-full flex-auto sm:flex-none"
              value={quotaSortMode}
              onChange={updateQuotaSortMode}
              options={QUOTA_SORT_OPTIONS}
            />
          ) : null}
          <Button variant="secondary" size="sm" icon="hourglass_top" onClick={() => updateExpiringFirst(!expiringFirst)} disabled={!expiringFirst && !hasQuotaReset} aria-pressed={expiringFirst} className={expiringFirst ? "ring-1 ring-dd-warning" : ""}>
            <span>Expiring</span>
          </Button>
          <Button variant="danger" size="sm" icon="block" onClick={() => bulkSetActive(depletedIds, false)} disabled={bulkToggling || !depletedIds.length}>
            <span>Disable empty</span>
          </Button>
          <Button variant="primary" size="sm" icon="check_circle" onClick={() => bulkSetActive(availableIds, true)} disabled={bulkToggling || !availableIds.length}>
            <span>Enable available</span>
          </Button>
          <Button variant="secondary" size="sm" icon={autoRefresh ? "toggle_on" : "toggle_off"} onClick={() => setAutoRefresh((prev) => !prev)}>
            <span>Auto</span>
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
      {expiringFirst ? <div className="rounded-dd border border-dd-warning/30 bg-dd-warning/10 px-3 py-2 text-xs text-dd-warning">Pages follow saved token expiry and rate-limit times. Accounts remain grouped by provider; live quota resets reorder only the current page.</div> : null}

      {connectionsError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger p-3 text-sm text-dd-danger"><p>Provider connections could not be loaded. {connectionsError}{connections.length ? " Last received accounts remain visible and may be stale." : " Retry to load your connections."}</p><Button icon="refresh" variant="secondary" disabled={refreshingAll} onClick={refreshAll}>Retry connections</Button></div> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy={connectionsLoading || undefined}>
        {connectionsLoading && !connections.length ? <Card className="md:col-span-2"><div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-dd-muted"><span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>Loading provider limits...</div></Card> : hasVisibleConnections ? providerGroups.map((group) => <ProviderGroupCard
          key={group.provider || group.connections[0]?.id}
          group={group}
          autoPingMaps={autoPingMaps}
          connectionQuotaRows={connectionQuotaRows}
          copied={copied}
          copy={copy}
          deletingId={deletingId}
          draggedProvider={draggedProvider}
          errors={errors}
          fetchConnections={fetchConnections}
          handleHideQuota={handleHideQuota}
          handleRefreshToken={handleRefreshToken}
          handleShowQuota={handleShowQuota}
          handleToggleConnectionActive={handleToggleConnectionActive}
          handleUltrafast={handleUltrafast}
          handleViewClaudeResets={handleViewClaudeResets}
          handleViewCodexResetCredits={handleViewCodexResetCredits}
          keyboardProvider={keyboardProvider}
          loading={loading}
          mergedProviders={mergedProviders}
          moveProvider={moveProvider}
          nodeLabels={nodeLabels}
          orderPending={orderPending}
          providerOrder={providerOrder}
          quotaData={quotaData}
          quotaSortMode={quotaSortMode}
          refreshProvider={refreshProvider}
          refreshingTokenId={refreshingTokenId}
          resettingLimitId={resettingLimitId}
          setDeleteConfirmState={setDeleteConfirmState}
          setKeyboardProvider={setKeyboardProvider}
          setResetConfirmState={setResetConfirmState}
          setSelectedConnection={setSelectedConnection}
          setShowEditModal={setShowEditModal}
          toggleAutoPing={toggleAutoPing}
          toggleMergedView={toggleMergedView}
          togglingId={togglingId}
          uiV5={uiV5}
        />
        ) : connectionsError ? null : <div className="md:col-span-2"><Card><EmptyState icon={emptyState.icon} title={emptyState.title} message={emptyState.description} /></Card></div>}
      </div>
      {orderError ? <div role="alert">{orderError}</div> : null}
      {connectionsLoaded ? <ConnectionsPager
        connectionsPageSummary={connectionsPageSummary}
        customPageSizeMode={customPageSizeMode}
        pageSize={pageSize}
        setCustomPageSizeMode={setCustomPageSizeMode}
        updatePageSize={updatePageSize}
        customPageSizeInput={customPageSizeInput}
        setCustomPageSizeInput={setCustomPageSizeInput}
        pagination={pagination}
        updatePage={updatePage}
      /> : null}

      <ConfirmDialog open={Boolean(resetConfirmState)} onCancel={() => { if (!resettingLimitId) setResetConfirmState(null); }} onConfirm={async () => { const connection = resetConfirmState?.connection; if (!connection) return; await handleResetLimit(connection.id, connection.provider, resetConfirmState?.grantId); setResetConfirmState(null); }} title={resetConfirmState?.connection?.provider === "claude" ? "Reset Claude limits?" : "Reset Codex limit?"} message={resetConfirmState?.connection?.provider === "claude" ? `Refills your ${formatClaudeResetClears(quotaData[resetConfirmState.connection.id]?.raw?.resetCredits?.clears)} now for ${getConnectionLabel(resetConfirmState.connection) || "this account"} · your weekly reset day stays ${formatCreditDate(quotaData[resetConfirmState.connection.id]?.raw?.resetCredits?.weeklyResetsAt)}. This cannot be undone. Resets left: ${resetConfirmState.resetCreditCount ?? 0}.` : `Use 1 Codex reset credit for ${getConnectionLabel(resetConfirmState?.connection || {}) || "this account"}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`} confirmLabel="Reset limit" cancelLabel="Cancel" tone="danger" pending={Boolean(resettingLimitId)} />
      <ConfirmDialog open={Boolean(deleteConfirmState)} onCancel={() => { if (!deletingId) setDeleteConfirmState(null); }} onConfirm={async () => { const connection = deleteConfirmState; if (!connection) return; await handleDeleteConnection(connection.id); setDeleteConfirmState(null); }} title="Delete connection?" message={`Delete ${getConnectionLabel(deleteConfirmState || {}) || "this connection"}? This cannot be undone.`} confirmLabel="Delete connection" cancelLabel="Cancel" tone="danger" pending={Boolean(deletingId)} />

      <ResetCreditsModal resetCreditsState={resetCreditsState} setResetCreditsState={setResetCreditsState} />

      <EditConnectionModal isOpen={showEditModal} connection={selectedConnection} proxyPools={proxyPools} onSave={handleUpdateConnection} onClose={() => { setShowEditModal(false); setSelectedConnection(null); }} />
    </div>);
}
