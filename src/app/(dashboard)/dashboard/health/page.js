"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/shared/ui/components/Button.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import { usePagination } from "@/shared/hooks/usePagination";
import { createVisiblePoller } from "@/shared/utils/visiblePoller";

const STATE_TONE = { healthy: "success", degraded: "warning", down: "danger", blocked: "danger", unconfigured: "neutral", unknown: "neutral" };
const STATE_LABEL = { healthy: "Healthy", degraded: "Degraded", down: "Down", blocked: "Blocked (SSRF)", unconfigured: "Unconfigured", unknown: "Unknown" };

const SUMMARY_TILES = [
  { key: "total", label: "Total", tone: "default" },
  { key: "healthy", label: "Healthy", tone: "success" },
  { key: "degraded", label: "Degraded", tone: "warning" },
  { key: "down", label: "Down", tone: "danger" },
  { key: "blocked", label: "Blocked", tone: "danger" },
  { key: "unconfigured", label: "Unconfigured", tone: "neutral" },
];

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [headroom, setHeadroom] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setError("");
    try {
      const url = force ? "/api/health/providers?force=1" : "/api/health/providers";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Health request failed (${res.status})`);
      }
      const [healthData, headroomRes] = await Promise.all([
        res.json(),
        fetch("/api/headroom/status", { cache: "no-store" }).catch(() => null),
      ]);
      setData(healthData);
      if (headroomRes?.ok) setHeadroom(await headroomRes.json());
    } catch (err) {
      setError(err?.message || "Failed to load health");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const poller = createVisiblePoller({ callback: () => load(false), intervalMs: 60_000 });
    poller.start();
    return () => poller.stop();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/health/providers", { method: "DELETE" });
    } catch {
      /* best-effort cache bust */
    }
    load(true);
  };

  const summary = data?.summary || {};
  const providers = data?.providers || [];

  const { pageItems, page, pageSize, setPage, setPageSize, totalItems, totalPages } = usePagination({
    items: providers,
    pageSize: 20,
  });

  const headroomTone = headroom?.running ? (headroom?.circuit?.degraded ? "warning" : "success") : "warning";
  const headroomLabel = headroom?.running
    ? headroom?.circuit?.degraded
      ? `Degraded (${headroom.circuit.consecutiveFailures})`
      : "Healthy"
    : "Unavailable (fail-open)";

  const columns = [
    { key: "name", label: "Connection", render: (row) => <span className="text-[13px] font-medium text-dd-text">{row.name}</span> },
    { key: "provider", label: "Provider", render: (row) => <span className="inline-flex items-center gap-2"><ProviderLogo provider={row.provider} size={20} /><span className="text-[13px] text-dd-muted">{row.provider}</span></span> },
    { key: "state", label: "State", render: (row) => <StatusDot tone={STATE_TONE[row.state] || "neutral"} label={STATE_LABEL[row.state] || row.state} /> },
    { key: "status", label: "Status", mono: true, align: "right", render: (row) => <span className="dd-tnum text-[13px] text-dd-muted">{row.statusCode ?? "—"}</span> },
    { key: "latency", label: "Latency", mono: true, align: "right", render: (row) => <span className="dd-tnum text-[13px] text-dd-muted">{row.latencyMs != null ? `${row.latencyMs}ms` : "—"}</span> },
    { key: "error", label: "Error", render: (row) => <span className="block max-w-xs truncate text-[13px] text-dd-muted" title={row.error || ""}>{row.error || "—"}</span> },
  ];

  return <div className="space-y-6">
    <PageHeader icon="health_and_safety" title="Provider Health" subtitle="Reachability of your configured provider connections. Probes are SSRF-guarded and proxy-aware." actions={<Button variant="primary" onClick={onRefresh} disabled={refreshing} loading={refreshing} icon="refresh">{refreshing ? "Refreshing…" : "Refresh"}</Button>} />
    {error ? <div className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-[13px] text-dd-danger" role="alert">{error}</div> : null}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {SUMMARY_TILES.map((tile) => <StatCard key={tile.key} label={tile.label} value={summary[tile.key] ?? 0} tone={tile.tone} />)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-dd-lg border border-dd-border bg-dd-surface p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent"><span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none">compress</span></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-dd-text">Headroom compression proxy</div>
          <div className="truncate text-xs text-dd-muted">{headroom?.url || "Not configured"}</div>
          {headroom?.circuit?.degraded ? <div className="mt-1 text-xs text-dd-warning">Circuit degraded: {headroom.circuit.consecutiveFailures} consecutive failures</div> : null}
        </div>
      </div>
      <StatusDot tone={headroomTone} label={headroomLabel} pulse={headroomTone === "success"} />
    </div>
    <DataTable
      caption="Configured provider connections and their reachability probes"
      ariaLabel="Provider health connections"
      columns={columns}
      rows={pageItems}
      keyFn={(row) => row.id}
      getRowLabel={(row) => row.name}
      density="compact"
      loading={loading && providers.length === 0}
      emptyState={{ icon: "monitor_heart", title: "No active connections", message: "No active connections configured.", action: { label: "Refresh", icon: "refresh", onClick: onRefresh } }}
      pagination={{ page, pageCount: totalPages, total: totalItems, rowsLabel: `Showing ${totalItems === 0 ? 0 : (page - 1) * pageSize + 1}–${(page - 1) * pageSize + pageItems.length} of ${totalItems}`, onPage: setPage, rowsPerPage: pageSize, onRowsPerPageChange: setPageSize }}
    />
    {data?.timestamp ? <p className="text-xs text-dd-subtle">Last computed: {new Date(data.timestamp).toLocaleString()}</p> : null}
  </div>;
}
