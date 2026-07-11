"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";

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
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setError("");
    try {
      const url = force ? "/api/health/providers?force=1" : "/api/health/providers";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err?.message || "Failed to load health");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(false), 5000);
    return () => clearInterval(id);
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
              {providers.map((p) => (
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

      {data?.timestamp && (
        <p className="text-xs text-text-muted">Last computed: {new Date(data.timestamp).toLocaleString()}</p>
      )}
    </div>
  );
}
