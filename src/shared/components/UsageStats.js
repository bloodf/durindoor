"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";
import { createLatestRequestGuard, mergeUsageResponse } from "@/shared/utils/requestFreshness";
import { allocateUsageCost } from "@/shared/utils/usageCostAllocation";
import { buildUsageProviders } from "@/shared/utils/usageProviders";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import { formatCompactToken } from "@/shared/utils/formatCompact";
import dynamic from "next/dynamic";
// Lazy-load: keeps @xyflow/react out of the shared bundle until topology renders
import { isString } from "../utils/typeChecks.js";
const ProviderTopology = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"), { ssr: false });
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";
import RequestsPanel from "@/app/(dashboard)/dashboard/usage/components/RequestsPanel";


function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {}).
  map(([key, data]) => {
    const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
    const totalCost = data.cost || 0;
    // ponytail: cost split is a token-share allocation of the (rate-accurate)
    // server total, not a per-rate recompute. cached is a subset of prompt, so
    // peel it out of the input share. Upgrade to a stored per-component cost
    // breakdown if exact cached-rate cost display is needed.
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
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, cacheCreationTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, cachedCost: 0, cacheCreationCost: 0, outputCost: 0, reasoningCost: 0, lastUsed: null, pending: 0 },
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

export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, customRange = null, isCustomRange = false, hidePeriodSelector = false, resetNonce = 0 } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
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

  // Fetch connected providers once, deduplicate by provider type
  // Always include noAuth free providers (e.g. opencode) regardless of connections
  useEffect(() => {
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
  }, []);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    const controller = new AbortController();
    statsFetchAbortRef.current = controller;
    const requestToken = statsRequestGuard.begin();
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
    then((r) => r.ok ? r.json() : null).
    then((data) => {
      if (data && !controller.signal.aborted && requestToken.isCurrent()) {
        setStats((prev) => mergeUsageResponse(prev, data, liveOverlayRef.current));
      }
    }).
    catch((error) => {
      if (error?.name !== "AbortError") console.error("Failed to fetch usage stats:", error);
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
  }, [period, customRange?.startDate, customRange?.endDate, statsRequestGuard, resetNonce]);

  /**
   * Upstream #3388: period-keyed SSE owns preset snapshots, while custom-range
   * REST totals stay authoritative because the stream cannot express dates.
   */
  useEffect(() => {
    const es = new EventSource(`/api/usage/stream?period=${encodeURIComponent(period)}`);

    es.onmessage = (e) => {
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
        mergeUsageResponse(prev, prev, liveOverlayRef.current) :
        data);
        if (!isCustomRange) {
          setLoading(false);
          setFetching(false);
        }
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, [period, isCustomRange]);

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

  if (!stats && !loading) return <div className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 p-4 text-[13px] text-dd-danger" role="alert">Failed to load usage statistics.</div>;

  const spinner =
  <div className="flex items-center justify-center py-12 text-dd-muted" role="status">
      <span aria-hidden="true" className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
      <span className="sr-only">Loading usage statistics</span>
    </div>;


  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Period selector (hidden when controlled by parent) */}
      {!hidePeriodSelector &&
      <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <SegmentedControl aria-label="Usage period" options={PERIODS} value={period} onChange={setPeriod} disabled={fetching} size="sm" />
          {fetching && <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-dd-muted animate-spin">progress_activity</span>}
        </div>
      }

      {/* Overview cards */}
      {loading ? spinner : <OverviewCards stats={stats} />}

      {/* Provider topology + tabbed requests panel */}
      {loading ? spinner :
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ProviderTopology
          providers={providers}
          activeRequests={stats.activeRequests || []}
          lastProvider={stats.recentRequests?.[0]?.provider || ""}
          errorProvider={stats.errorProvider || ""} />
        
          <RequestsPanel recentRequests={stats.recentRequests || []} activeSessions={stats.activeSessions || []} formatToken={formatCompactToken} />
        </div>
      }

      {/* Token / Cost chart — preset ranges only. On a custom calendar range the
           chart endpoint has no matching window, so show an honest note instead
           of a graph that disagrees with the cards/table above. Request count is
           stable but can miss a 24h refresh when one request enters as another
           ages out. */}
      {loading ? spinner : isCustomRange ?
      <div className="flex h-40 items-center justify-center rounded-dd-lg border border-dd-border bg-dd-surface text-[13px] text-dd-muted">
          Chart shows preset ranges only — pick a preset to view graph.
        </div> :
      <UsageChart period={period} refreshKey={stats.totalRequests} />}

      {/* Table with dropdown selector */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select aria-label="Usage grouping" options={TABLE_OPTIONS} value={tableView} onChange={setTableView} size="sm" className="sm:w-56" />
          <SegmentedControl aria-label="Usage value type" options={[{ value: "costs", label: "Costs" }, { value: "tokens", label: "Tokens" }]} value={viewMode} onChange={setViewMode} size="sm" />
        </div>
        {loading ? spinner : activeTableConfig &&
        <UsageTable
          title=""
          groupedData={activeTableConfig.groupedData}
          groupColumns={activeTableConfig.groupColumns}
          detailColumns={activeTableConfig.detailColumns}
          tableType={tableView}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onToggleSort={toggleSort}
          valueMode={viewMode}
          storageKey={activeTableConfig.storageKey}
          emptyMessage={activeTableConfig.emptyMessage} />

        }
      </div>
    </div>);

}