"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { createLiveReloadScheduler } from "./href.js";
import { buildConnectionNameMap, connectionDisplayName } from "@/shared/utils/connectionDisplay.js";
import TimelineSkeleton from "./TimelineSkeleton.jsx";
import TimelineSwimlane from "./components/TimelineSwimlane.jsx";
import TimelineWindowControls, { DEFAULT_LANE, DEFAULT_WINDOW, resolveLane, resolveWindow } from "./components/TimelineWindowControls.jsx";
import { statusTone } from "./timelineStatus.js";
import { useWindowedTraces } from "./useWindowedTraces.js";

const FILTER_KEYS = ["provider", "model", "connectionId", "apiKeyId", "status", "endpoint", "startDate", "endDate", "q"];
const WINDOW_FILTER_KEYS = FILTER_KEYS.filter((key) => key !== "startDate" && key !== "endDate");
const VIEW_OPTIONS = [
  { value: "timeline", label: "Timeline", icon: "view_timeline" },
  { value: "table", label: "Table", icon: "table_rows" },
];


export default function TimelinePage() {
  return <Suspense fallback={<TimelineSkeleton />}><TimelineList /></Suspense>;
}

function TimelineList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState({ traces: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } });
  const loadAbortRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [captureOn, setCaptureOn] = useState(null);
  const [connectionNames, setConnectionNames] = useState({});
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const view = searchParams.get("view") === "table" ? "table" : "timeline";
  const windowPreset = resolveWindow(searchParams.get("window"));
  const laneBy = resolveLane(searchParams.get("lane"));
  const windowFilterQuery = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of WINDOW_FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  }, [searchParams]);
  const windowed = useWindowedTraces({ enabled: view === "timeline", filterQuery: windowFilterQuery, windowMs: windowPreset.ms, live });
  const query = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    next.set("page", searchParams.get("page") || "1");
    next.set("pageSize", searchParams.get("pageSize") || "20");
    return next;
  }, [searchParams]);
  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setError("");
    setLoading(true);
    try {
      const settingsRequest = fetch("/api/settings", { cache: "no-store", signal: controller.signal });
      if (query.get("pageSize") === "all") {
        const allQuery = new URLSearchParams(query);
        allQuery.set("page", "1");
        allQuery.set("pageSize", "100");
        const traces = [];
        let totalItems = 0;
        for (;;) {
          const response = await fetch(`/api/timeline?${allQuery.toString()}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Failed to load timeline");
          const page = await response.json();
          traces.push(...(page.traces || []));
          totalItems = page.pagination?.totalItems ?? traces.length;
          if (traces.length >= totalItems || (page.traces || []).length === 0) break;
          allQuery.set("page", String(Number(allQuery.get("page")) + 1));
        }
        if (!controller.signal.aborted) setData({ traces, pagination: { page: 1, pageSize: "all", totalItems, totalPages: 1 } });
      } else {
        const response = await fetch(`/api/timeline?${query.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Failed to load timeline");
        const body = await response.json();
        if (!controller.signal.aborted) setData(body);
      }
      const settingsRes = await settingsRequest;
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (!controller.signal.aborted) setCaptureOn(settings.enableProxyTimeline === true);
      }
    } catch (err) {      if (err?.name !== "AbortError") setError(err?.message || "Failed to load timeline");
    } finally {
      if (loadAbortRef.current === controller) setLoading(false);
    }
  }, [query]);
  const liveReload = useMemo(() => createLiveReloadScheduler(load), [load]);
  useEffect(() => {
    if (view !== "table") return undefined;
    load();
    return () => loadAbortRef.current?.abort();
  }, [load, view]);
  // Connection ids render as names; fetch the catalog once (fail-open).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled && body) setConnectionNames(buildConnectionNameMap(body.connections)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Timeline observes mutable filter transitions and filters fetched metadata
  // locally. Keep its subscription stable across lane/window URL changes.
  const liveScheduler = view === "table" ? liveReload : windowed.liveRefresh;
  const streamQuery = view === "table" ? query.toString() : "";
  useEffect(() => {
    if (!live) return undefined;
    const source = new EventSource(`/api/timeline/stream?${streamQuery}`);
    source.onmessage = liveScheduler.schedule;
    return () => { liveScheduler.cancel(); source.close(); };
  }, [live, streamQuery, liveScheduler]);

  const setParam = (key, value, defaultValue) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    router.replace(search ? `/dashboard/timeline?${search}` : "/dashboard/timeline");
  };
  const openTrace = (traceId) => router.push(`/dashboard/timeline/${encodeURIComponent(traceId)}`);
  const formatLane = (key) => (laneBy === "connection_id" ? connectionDisplayName(key, connectionNames) : key);

  const pagination = data.pagination || { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 };
  const setPage = (page) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    router.replace(`/dashboard/timeline?${next.toString()}`);
  };
  const setRowsPerPage = (pageSize) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    next.set("pageSize", String(pageSize));
    router.replace(`/dashboard/timeline?${next.toString()}`);
  };
  const columns = useMemo(() => [
    { key: "started_at", label: "Started", rowHeader: true, render: (trace) => <Link href={`/dashboard/timeline/${trace.id}`} className="inline-flex min-h-11 min-w-11 items-center whitespace-nowrap text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus">{trace.started_at}</Link> },
    { key: "status", label: "Status", render: (trace) => <Badge tone={statusTone(trace.status || "running")} size="sm">{trace.status || "running"}</Badge> },
    { key: "provider", label: "Provider", render: (trace) => trace.provider ? <span className="inline-flex items-center gap-2"><ProviderLogo provider={trace.provider} size={16} /><span>{trace.provider}</span></span> : "—" },
    { key: "model", label: "Model", mono: true, render: (trace) => trace.model || "—" },
    { key: "connection_id", label: "Connection", mono: true, render: (trace) => connectionDisplayName(trace.connection_id, connectionNames) },
    { key: "event_count", label: "Events", align: "right", render: (trace) => trace.event_count ?? 0 },
    { key: "fallback_count", label: "Fallbacks", align: "right", render: (trace) => trace.fallback_count ?? 0 },
    { key: "total_ms", label: "ms", align: "right", mono: true, render: (trace) => trace.total_ms ?? "—" },
  ], [connectionNames]);

  const captureOff = (view === "table" ? captureOn : windowed.captureOn) === false;
  const emptyState = {
    icon: "timeline",
    title: captureOff ? "Timeline capture is off" : "Waiting for a call",
    message: captureOff ? <span>Enable it in <Link href="/dashboard/profile" className="text-dd-accent underline outline-none focus-visible:shadow-dd-focus">Settings</Link>.</span> : "Redacted proxy hops appear here when requests arrive.",
  };
  const liveStatus = <p className="text-[13px] text-dd-muted"><StatusDot tone={live ? "success" : "neutral"} pulse={live} label={live ? "Listening for updates" : "Live updates paused"} /></p>;
  const viewError = view === "table" ? error : windowed.error;
  const windowCount = windowed.traces.length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        icon="timeline"
        title="Timeline"
        subtitle="Redacted sidecar hops. Filter via URL query string."
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl aria-label="Timeline view" options={VIEW_OPTIONS} value={view} onChange={(value) => setParam("view", value, "timeline")} />
            {view === "table" ? <Toggle checked={live} onChange={setLive} label="Live updates" aria-label="Live timeline updates" /> : null}
          </div>
        )}
      />
      {viewError ? <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-[13px] text-dd-danger">{viewError}</p> : null}
      {view === "table" ? (
        <DataTable
          columns={columns}
          rows={data.traces}
          keyFn={(trace) => trace.id}
          caption="Timeline traces"
          density="compact"
          filterBar={liveStatus}
          loading={loading}
          emptyState={emptyState}
          pagination={{ page: pagination.page, pageCount: pagination.totalPages, total: pagination.totalItems, rowsLabel: pagination.totalItems > 0 ? `${pagination.totalItems.toLocaleString()} traces` : "0 traces", onPage: setPage, rowsPerPage: pagination.pageSize, rowsPerPageOptions: pagination.pageSize === 20 ? [10, 20, 25, 50, 100, "all"] : [10, 25, 50, 100, "all"], onRowsPerPageChange: setRowsPerPage }}
        />
      ) : (
        <Card padding={false}>
          <CardHeader
            icon="view_timeline"
            title="Swimlanes"
            subtitle={`${windowCount.toLocaleString()} trace${windowCount === 1 ? "" : "s"} in the last ${windowPreset.label}`}
            actions={liveStatus}
          />
          <CardContent className="flex flex-col gap-4">
            <TimelineWindowControls
              windowKey={windowPreset.value}
              onWindowChange={(value) => setParam("window", value, DEFAULT_WINDOW)}
              laneBy={laneBy}
              onLaneByChange={(value) => setParam("lane", value, DEFAULT_LANE)}
              live={live}
              onLiveChange={setLive}
            />
            {windowed.loading && windowCount === 0 ? (
              <div role="status" aria-busy="true" className="h-40 animate-pulse rounded-dd bg-dd-surface-2"><span className="sr-only">Loading traces</span></div>
            ) : (
              <TimelineSwimlane
                traces={windowed.traces}
                windowStart={windowed.windowStart}
                windowEnd={windowed.nowMs}
                laneBy={laneBy}
                onSelect={openTrace}
                nowMs={windowed.nowMs}
                formatLane={formatLane}
                emptyState={emptyState}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
