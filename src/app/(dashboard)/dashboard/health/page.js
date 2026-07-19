"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import { usePagination } from "@/shared/hooks/usePagination";
import { createVisiblePoller } from "@/shared/utils/visiblePoller";

const STATE_VARIANT = {
  healthy: "success",
  degraded: "warning",
  down: "error",
  blocked: "error",
  unconfigured: "default",
  unknown: "default",
};

const STATE_LABEL = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  blocked: "Blocked (SSRF)",
  unconfigured: "Unconfigured",
  unknown: "Unknown",
};

function SummaryCard({ label, value, variant }) {
  return (
    <Card padding="sm">
      <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-semibold">{value ?? 0}</span>
        {variant && <Badge variant={variant} size="sm">{label}</Badge>}
      </div>
    </Card>
  );
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Provider Health</h1>
          <p className="text-sm text-text-muted">
            Reachability of your configured provider connections. Probes are SSRF-guarded and proxy-aware.
          </p>
        </div>
        <Button onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <Card padding="sm">
          <span className="text-sm text-red-500">{error}</span>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total" value={summary.total} />
        <SummaryCard label="Healthy" value={summary.healthy} variant="success" />
        <SummaryCard label="Degraded" value={summary.degraded} variant="warning" />
        <SummaryCard label="Down" value={summary.down} variant="error" />
        <SummaryCard label="Blocked" value={summary.blocked} variant="error" />
        <SummaryCard label="Unconfigured" value={summary.unconfigured} />
      </div>
      <Card padding="sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Headroom compression proxy</div>
            <div className="text-xs text-text-muted">{headroom?.url || "Not configured"}</div>
            {headroom?.circuit?.degraded && (
              <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                Circuit degraded: {headroom.circuit.consecutiveFailures} consecutive failures
              </div>
            )}
          </div>
          <Badge
            variant={headroom?.running ? (headroom?.circuit?.degraded ? "warning" : "success") : "warning"}
            size="sm"
          >
            {headroom?.running
              ? headroom?.circuit?.degraded
                ? `Degraded (${headroom.circuit.consecutiveFailures})`
                : "Healthy"
              : "Unavailable (fail-open)"}
          </Badge>
        </div>
      </Card>


      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border-subtle">
                <th className="py-2 pr-4">Connection</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">State</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Latency</th>
                <th className="py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {loading && providers.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-text-muted">Loading…</td></tr>
              )}
              {!loading && providers.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-text-muted">No active connections configured.</td></tr>
              )}
              {pageItems.map((p) => (
                <tr key={p.id} className="border-b border-border-subtle/50">
                  <td className="py-2 pr-4 font-medium">{p.name}</td>
                  <td className="py-2 pr-4 text-text-muted">{p.provider}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={STATE_VARIANT[p.state] || "default"} size="sm">
                      {STATE_LABEL[p.state] || p.state}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 text-text-muted">{p.statusCode ?? "—"}</td>
                  <td className="py-2 pr-4 text-text-muted">
                    {p.latencyMs != null ? `${p.latencyMs}ms` : "—"}
                  </td>
                  <td className="py-2 text-text-muted truncate max-w-xs" title={p.error || ""}>
                    {p.error || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {data?.timestamp && (
        <p className="text-xs text-text-muted">Last computed: {new Date(data.timestamp).toLocaleString()}</p>
      )}
    </div>
  );
}
