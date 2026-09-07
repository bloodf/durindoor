"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { createLiveReloadScheduler } from "./href.js";
import TimelineSkeleton from "./TimelineSkeleton.jsx";

const FILTER_KEYS = ["provider", "model", "connectionId", "apiKeyId", "status", "endpoint", "startDate", "endDate"];

function statusTone(status) {
  if (status === "ok") return "success";
  if (status === "aborted") return "warning";
  if (status === "error") return "danger";
  if (status === "running") return "info";
  return "neutral";
}


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
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
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
    } catch (err) {
      if (err?.name !== "AbortError") setError(err?.message || "Failed to load timeline");
    } finally {
      if (loadAbortRef.current === controller) setLoading(false);
    }
  }, [query]);
  const liveReload = useMemo(() => createLiveReloadScheduler(load), [load]);
  useEffect(() => {
    load();
    return () => loadAbortRef.current?.abort();
  }, [load]);
  useEffect(() => {
    if (!live) return undefined;
    const source = new EventSource(`/api/timeline/stream?${query.toString()}`);
    source.onmessage = liveReload.schedule;
    return () => { liveReload.cancel(); source.close(); };
  }, [live, query, liveReload]);

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
    { key: "connection_id", label: "Connection", mono: true, render: (trace) => trace.connection_id || "—" },
    { key: "event_count", label: "Events", align: "right", render: (trace) => trace.event_count ?? 0 },
    { key: "fallback_count", label: "Fallbacks", align: "right", render: (trace) => trace.fallback_count ?? 0 },
    { key: "total_ms", label: "ms", align: "right", mono: true, render: (trace) => trace.total_ms ?? "—" },
  ], []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader icon="timeline" title="Timeline" subtitle="Redacted sidecar hops. Filter via URL query string." actions={<Toggle checked={live} onChange={setLive} label="Live updates" aria-label="Live timeline updates" />} />
      {error ? <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-[13px] text-dd-danger">{error}</p> : null}
      <DataTable
        columns={columns}
        rows={data.traces}
        keyFn={(trace) => trace.id}
        caption="Timeline traces"
        density="compact"
        filterBar={<p className="text-[13px] text-dd-muted"><StatusDot tone={live ? "success" : "neutral"} pulse={live} label={live ? "Listening for updates" : "Live updates paused"} /></p>}
        loading={loading}
        emptyState={{ icon: "timeline", title: captureOn === false ? "Timeline capture is off" : "Waiting for a call", message: captureOn === false ? <span>Enable it in <Link href="/dashboard/profile" className="text-dd-accent underline outline-none focus-visible:shadow-dd-focus">Settings</Link>.</span> : "Redacted proxy hops appear here when requests arrive." }}
        pagination={{ page: pagination.page, pageCount: pagination.totalPages, total: pagination.totalItems, rowsLabel: pagination.totalItems > 0 ? `${pagination.totalItems.toLocaleString()} traces` : "0 traces", onPage: setPage, rowsPerPage: pagination.pageSize, rowsPerPageOptions: pagination.pageSize === 20 ? [10, 20, 25, 50, 100, "all"] : [10, 25, 50, 100, "all"], onRowsPerPageChange: setRowsPerPage }}
      />
    </div>
  );
}
