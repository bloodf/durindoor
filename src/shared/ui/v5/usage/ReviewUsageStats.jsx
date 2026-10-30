"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";
import { createLatestRequestGuard, mergeUsageResponse } from "@/shared/utils/requestFreshness";
import { allocateUsageCost } from "@/shared/utils/usageCostAllocation";
import { buildUsageProviders } from "@/shared/utils/usageProviders";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import { formatCompactToken } from "@/shared/utils/formatCompact";
import dynamic from "next/dynamic";
// Lazy-load: keeps @xyflow/react out of the shared bundle until topology renders
import { isString } from "@/shared/utils/typeChecks.js";
const ProviderTopology = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"), { ssr: false });
import UsageChart from "./ReviewUsageChart.jsx";
import RequestsPanel from "@/app/(dashboard)/dashboard/usage/components/RequestsPanel";


function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {}).
  map(([key, data]) => {
    const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
    const totalCost = data.cost || 0;
    // Cost categories are priced at their own rates server-side, where pricing
    // lives; allocateUsageCost falls back to a token-share split only for
    // buckets whose model has no pricing entry.
    const allocation = allocateUsageCost(data);
    return { ...data, key, totalTokens, totalCost, ...allocation, pending: pendingMap[key] || 0 };
  }).
  sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (isString(valA)) valA = valA.toLowerCase();
    if (isString(valB)) valB = valB.toLowerCase();
    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel":return item.rawModel || "Unknown Model";
    case "accountName":return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName":return item.keyName || "Unknown Key";
    case "endpoint":return item.endpoint || "Unknown Endpoint";
    default:return item[keyField] || "Unknown";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, cachedCost: 0, cacheCreationCost: 0, outputCost: 0, reasoningCost: 0, unsplitCost: 0, lastUsed: null, pending: 0 },
        items: []
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.reasoningTokens += item.reasoningTokens || 0;
    s.cacheCreationTokens += item.cacheCreationTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.cacheCreationCost += item.cacheCreationCost || 0;
    s.outputCost += item.outputCost || 0;
    s.reasoningCost += item.reasoningCost || 0;
    s.unsplitCost += item.unsplitCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

/** Return metadata only when a collapsed group represents one usage record. */
function getSingleGroupItem(group) {
  return group.items.length === 1 ? group.items[0] : null;
}



const TABLE_OPTIONS = [
{ value: "model", label: "Usage by Model" },
{ value: "provider", label: "Usage by Provider" },
{ value: "account", label: "Usage by Account" },
{ value: "apiKey", label: "Usage by API Key" },
{ value: "endpoint", label: "Usage by Endpoint" }];


const PERIODS = USAGE_PERIOD_OPTIONS;

/** Review-only composition of production usage handlers; all API/SSE and grouping contracts remain intact. */
export default function ReviewUsageStats({ renderSections, period: periodProp, setPeriod: setPeriodProp, customRange = null, isCustomRange = false, hidePeriodSelector = false, enabled = true, resetNonce = 0 } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [streamError, setStreamError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState("costs");
  const [providers, setProviders] = useState([]);
  const [periodLocal, setPeriodLocal] = useState("today");
  const [statsRequestGuard] = useState(createLatestRequestGuard);
  const isInitialLoad = useRef(true);
  const liveOverlayRef = useRef({});
  const statsFetchAbortRef = useRef(null);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;
  const snapshotKey = JSON.stringify([period, customRange?.startDate || "", customRange?.endDate || "", isCustomRange]);
  const periodLabel = isCustomRange && customRange?.startDate && customRange?.endDate
    ? `${customRange.startDate} to ${customRange.endDate}`
    : PERIODS.find((option) => option.value === period)?.label || period;

  // Fetch connected providers once, deduplicate by provider type
  // Always include noAuth free providers (e.g. opencode) regardless of connections
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    Promise.all([
    fetch("/api/providers", { signal: controller.signal }).then((r) => r.ok ? r.json() : null),
    fetch("/api/provider-nodes", { signal: controller.signal }).then((r) => r.ok ? r.json() : null),
    fetch("/api/settings", { signal: controller.signal }).then((r) => r.ok ? r.json() : null)]
    ).
    then(([d, nodesData, settings]) => {
      const providers = buildUsageProviders(
        d?.connections || [],
        nodesData?.nodes || [],
        settings?.disabledFreeProviders || []
      );
      if (!controller.signal.aborted) setProviders(providers);
    }).
    catch(() => {});
    return () => controller.abort();
  }, [enabled]);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    statsFetchAbortRef.current = controller;
    const requestToken = statsRequestGuard.begin();
    setRequestError("");
    // First load: show full spinner; subsequent: show subtle fetching indicator
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setLoading(true);
    } else {
      setFetching(true);
    }

    const rangeParams = customRange?.startDate && customRange?.endDate ?
    `&startDate=${encodeURIComponent(customRange.startDate)}&endDate=${encodeURIComponent(customRange.endDate)}` :
    "";
    fetch(`/api/usage/stats?period=${encodeURIComponent(period)}${rangeParams}`, { signal: controller.signal }).
    then((r) => { if (!r.ok) throw new Error("Usage statistics could not be refreshed."); return r.json(); }).
    then((data) => {
      if (!data) throw new Error("Usage statistics could not be refreshed.");
      if (data && !controller.signal.aborted && requestToken.isCurrent()) {
        setStats((prev) => mergeUsageResponse(prev, data, liveOverlayRef.current));
        setSnapshot({ key: snapshotKey, label: periodLabel });
        setRequestError("");
      }
    }).
    catch((error) => {
      if (error?.name !== "AbortError" && !controller.signal.aborted && requestToken.isCurrent()) {
        setRequestError("Usage statistics could not be refreshed.");
      }
    }).
    finally(() => {
      if (statsFetchAbortRef.current === controller) statsFetchAbortRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        setFetching(false);
      }
    });
    return () => {
      controller.abort();
      if (statsFetchAbortRef.current === controller) statsFetchAbortRef.current = null;
      requestToken.cancel();
    };
  }, [period, customRange?.startDate, customRange?.endDate, isCustomRange, snapshotKey, periodLabel, statsRequestGuard, resetNonce, retryNonce, enabled]);

  /**
   * Upstream #3388: period-keyed SSE owns preset snapshots, while custom-range
   * REST totals stay authoritative because the stream cannot express dates.
   */
  useEffect(() => {
    if (!enabled) return undefined;
    const es = new EventSource(`/api/usage/stream?period=${encodeURIComponent(period)}`);
    let active = true;
    setStreamError("");

    es.onmessage = (e) => {
      if (!active) return;
      try {
        const data = JSON.parse(e.data);
        liveOverlayRef.current = {
          activeRequests: data.activeRequests,
          activeSessions: data.activeSessions,
          recentRequests: data.recentRequests,
          errorProvider: data.errorProvider,
          pending: data.pending
        };
        if (!isCustomRange) {
          const staleRest = statsFetchAbortRef.current;
          staleRest?.abort();
          if (statsFetchAbortRef.current === staleRest) statsFetchAbortRef.current = null;
        }
        setStats((prev) => isCustomRange ?
        prev ? mergeUsageResponse(prev, prev, liveOverlayRef.current) : null :
        data);
        if (!isCustomRange) {
          setSnapshot({ key: snapshotKey, label: periodLabel });
          setRequestError("");
          setLoading(false);
          setFetching(false);
        }
        setStreamError("");
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
        setStreamError("Live usage update could not be read.");
      }
    };

    es.onerror = () => {
      if (!active) return;
      setStreamError("Live usage updates are unavailable.");
      setLoading(false);
    };

    return () => { active = false; es.close(); };
  }, [period, isCustomRange, snapshotKey, periodLabel, retryNonce, enabled]);

  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    const providerBadge = (item) => <Badge tone={item.pending > 0 ? "accent" : "neutral"} size="sm">{item.provider || "—"}</Badge>;
    const neutralProviderBadge = (item) => <Badge tone="neutral" size="sm">{item.provider || "—"}</Badge>;
    switch (tableView) {
      case "model":{
          const pendingMap = stats.pending?.byModel || {};
          return {
            groupedData: groupDataByKey(sortData(stats.byModel, pendingMap, sortBy, sortOrder), "rawModel"),
            storageKey: "usage-stats:expanded-models",
            emptyMessage: "No usage recorded yet.",
            groupColumns: [
              { key: "provider", label: "Provider", render: (group) => {
                const item = getSingleGroupItem(group);
                return item ? providerBadge(item) : <span className="text-dd-muted">—</span>;
              } },
              { key: "requests", label: "Requests", align: "right", render: (group) => fmt(group.summary.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (group) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(group.summary.lastUsed)}</span> },
            ],
            detailColumns: [
              { key: "rawModel", label: "Model", render: (item) => <span className={`font-medium transition-colors ${item.pending > 0 ? "text-dd-accent" : ""}`}>{item.rawModel}</span> },
              { key: "provider", label: "Provider", render: (item) => providerBadge(item) },
              { key: "requests", label: "Requests", align: "right", render: (item) => fmt(item.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (item) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(item.lastUsed)}</span> },
            ],
          };
        }
      case "provider":{
          return {
            groupedData: groupDataByKey(sortData(stats.byProvider, {}, sortBy, sortOrder), "key"),
            storageKey: "usage-stats:expanded-providers",
            emptyMessage: "No provider usage recorded yet.",
            groupColumns: [
              { key: "requests", label: "Requests", align: "right", render: (group) => fmt(group.summary.requests) },
            ],
            detailColumns: [
              { key: "requests", label: "Requests", align: "right", render: (item) => fmt(item.requests) },
            ],
          };
        }
      case "account":{
          const pendingMap = {};
          if (stats?.pending?.byAccount) {
            Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
              const connPending = stats.pending.byAccount[data.connectionId];
              if (connPending) {
                const rawProvider = data.rawProvider || data.provider;
                const modelKey = rawProvider ? `${data.rawModel} (${rawProvider})` : data.rawModel;
                pendingMap[accountKey] = connPending[modelKey] || 0;
              }
            });
          }
          return {
            groupedData: groupDataByKey(sortData(stats.byAccount, pendingMap, sortBy, sortOrder), "accountName"),
            storageKey: "usage-stats:expanded-accounts",
            emptyMessage: "No account-specific usage recorded yet.",
            groupColumns: [
              { key: "rawModel", label: "Model", render: (group) => {
                const item = getSingleGroupItem(group);
                return item?.rawModel || <span className="text-dd-muted">—</span>;
              } },
              { key: "provider", label: "Provider", render: (group) => {
                const item = getSingleGroupItem(group);
                return item ? providerBadge(item) : <span className="text-dd-muted">—</span>;
              } },
              { key: "requests", label: "Requests", align: "right", render: (group) => fmt(group.summary.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (group) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(group.summary.lastUsed)}</span> },
            ],
            detailColumns: [
              { key: "accountName", label: "Account", render: (item) => <span className={`font-medium transition-colors ${item.pending > 0 ? "text-dd-accent" : ""}`}>{item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}</span> },
              { key: "rawModel", label: "Model", render: (item) => <span className={`font-medium transition-colors ${item.pending > 0 ? "text-dd-accent" : ""}`}>{item.rawModel}</span> },
              { key: "provider", label: "Provider", render: (item) => providerBadge(item) },
              { key: "requests", label: "Requests", align: "right", render: (item) => fmt(item.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (item) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(item.lastUsed)}</span> },
            ],
          };
        }
      case "apiKey":{
          return {
            groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
            storageKey: "usage-stats:expanded-apikeys",
            emptyMessage: "No API key usage recorded yet.",
            groupColumns: [
              { key: "rawModel", label: "Model", render: (group) => {
                const item = getSingleGroupItem(group);
                return item?.rawModel || <span className="text-dd-muted">—</span>;
              } },
              { key: "provider", label: "Provider", render: (group) => {
                const item = getSingleGroupItem(group);
                return item ? neutralProviderBadge(item) : <span className="text-dd-muted">—</span>;
              } },
              { key: "requests", label: "Requests", align: "right", render: (group) => fmt(group.summary.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (group) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(group.summary.lastUsed)}</span> },
            ],
            detailColumns: [
              { key: "keyName", label: "API Key Name", render: (item) => <span className="font-medium">{item.keyName}</span> },
              { key: "rawModel", label: "Model", render: (item) => item.rawModel },
              { key: "provider", label: "Provider", render: (item) => neutralProviderBadge(item) },
              { key: "requests", label: "Requests", align: "right", render: (item) => fmt(item.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (item) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(item.lastUsed)}</span> },
            ],
          };
        }
      case "endpoint":
      default:{
          return {
            groupedData: groupDataByKey(sortData(stats.byEndpoint, {}, sortBy, sortOrder), "endpoint"),
            storageKey: "usage-stats:expanded-endpoints",
            emptyMessage: "No endpoint usage recorded yet.",
            groupColumns: [
              { key: "rawModel", label: "Model", render: (group) => {
                const item = getSingleGroupItem(group);
                return item?.rawModel || <span className="text-dd-muted">—</span>;
              } },
              { key: "provider", label: "Provider", render: (group) => {
                const item = getSingleGroupItem(group);
                return item ? neutralProviderBadge(item) : <span className="text-dd-muted">—</span>;
              } },
              { key: "requests", label: "Requests", align: "right", render: (group) => fmt(group.summary.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (group) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(group.summary.lastUsed)}</span> },
            ],
            detailColumns: [
              { key: "endpoint", label: "Endpoint", mono: true, render: (item) => <span className="font-mono text-xs">{item.endpoint}</span> },
              { key: "rawModel", label: "Model", render: (item) => item.rawModel },
              { key: "provider", label: "Provider", render: (item) => neutralProviderBadge(item) },
              { key: "requests", label: "Requests", align: "right", render: (item) => fmt(item.requests) },
              { key: "lastUsed", label: "Last Used", align: "right", render: (item) => <span className="whitespace-nowrap text-dd-muted">{fmtTime(item.lastUsed)}</span> },
            ],
          };
        }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  const spinner = <div className="flex items-center justify-center gap-2 py-12 text-dd-muted" role="status"><span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span><span>Loading usage statistics</span></div>;
  const failure = <div className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 p-4 text-dd-danger" role="alert">Failed to load usage statistics.</div>;
  // Keep independent combo and key-limit reports mounted when stats cannot load.
  const available = Boolean(stats);
  const pendingContent = loading ? spinner : failure;
  const sections = {
    overview: available ? <OverviewCards stats={stats} /> : pendingContent,
    topology: available ? <ProviderTopology providers={providers} activeRequests={stats.activeRequests || []} lastProvider={stats.recentRequests?.[0]?.provider || ""} errorProvider={stats.errorProvider || ""} /> : pendingContent,
    requests: available ? <RequestsPanel recentRequests={stats.recentRequests || []} activeSessions={stats.activeSessions || []} formatToken={formatCompactToken} /> : pendingContent,
    chart: !available ? pendingContent : isCustomRange ? <div className="flex h-40 items-center justify-center rounded-dd-lg border border-dd-border bg-dd-surface text-dd-muted">Chart shows preset ranges only — pick a preset to view graph.</div> : <UsageChart period={period} refreshKey={stats.totalRequests} />,
    breakdown: <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select aria-label="Usage grouping" options={TABLE_OPTIONS} value={tableView} onChange={setTableView} size="sm" className="sm:w-56" />
        <SegmentedControl aria-label="Usage value type" options={[{ value: "costs", label: "Costs" }, { value: "tokens", label: "Tokens" }]} value={viewMode} onChange={setViewMode} size="sm" />
      </div>
      {!available ? pendingContent : activeTableConfig ? <UsageTable title="" groupedData={activeTableConfig.groupedData} groupColumns={activeTableConfig.groupColumns} detailColumns={activeTableConfig.detailColumns} tableType={tableView} sortBy={sortBy} sortOrder={sortOrder} onToggleSort={toggleSort} valueMode={viewMode} storageKey={activeTableConfig.storageKey} emptyMessage={activeTableConfig.emptyMessage} /> : null}
    </div>,
  };
  return <div className="flex min-w-0 flex-col gap-6">
    {enabled && !hidePeriodSelector ? <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end"><SegmentedControl aria-label="Usage period" options={PERIODS} value={period} onChange={setPeriod} disabled={fetching} size="sm" /></div> : null}
    {enabled && snapshot && snapshot.key !== snapshotKey ? <p role="status" className="text-xs text-dd-muted">Showing previous {snapshot.label} usage. {fetching ? "Updating selected period…" : "Waiting for the selected period."}</p> : enabled && fetching && available ? <p role="status" className="text-xs text-dd-muted">Updating usage…</p> : null}
    {enabled && (requestError || streamError) ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger/30 p-3 text-xs text-dd-danger"><p>{requestError || streamError}{available ? " Last received usage remains visible." : ""}</p><Button variant="secondary" size="sm" onClick={() => setRetryNonce((value) => value + 1)}>Retry usage</Button></div> : null}
    {renderSections ? renderSections(enabled ? sections : {}) : enabled ? Object.entries(sections).map(([id, section]) => <section key={id} data-widget-id={id}>{section}</section>) : null}
  </div>;
}
