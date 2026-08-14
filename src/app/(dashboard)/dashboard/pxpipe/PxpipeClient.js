"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import PropTypes from "prop-types";
import { Card, Button } from "@/shared/components";
import { chartTooltipContentStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "@/shared/components/chartTooltip";
import Pagination from "@/shared/components/Pagination";
import { usePagination } from "@/shared/hooks/usePagination";
import { formatPxpipeEvent, fmtTokens, PXPIPE_REASON_LABELS as REASON_LABELS } from "./formatPxpipeEvent.js";
import { getPxpipeStatusView, fetchPxpipeStatus } from "./pxpipeStatus.js";

const fmtUptime = (ms) => {
  if (!ms || ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

const WINDOW_TABS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7d", label: "7 days" },
  { id: "last30d", label: "30 days" },
  { id: "all", label: "All time" },
];

function SummaryCard({ label, value, sub, tone }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${tone || ""}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </Card>
  );
}

SummaryCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  sub: PropTypes.node,
  tone: PropTypes.string,
};

export default function PxpipeClient({ embedded = false }) {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState(null);
  const [windowId, setWindowId] = useState("last7d");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [statusResult, statsResult, logsResult, healthResult] = await Promise.allSettled([
      fetchPxpipeStatus(),
      fetch("/api/pxpipe/stats").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/pxpipe/logs?limit=50").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/pxpipe/health", { method: "POST" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (statusResult.status === "fulfilled" && statusResult.value) {
      setStatus(statusResult.value);
    }
    if (statsResult.status === "fulfilled") {
      setStats(statsResult.value || null);
    }
    if (logsResult.status === "fulfilled") {
      setLogs(logsResult.value || null);
    }
    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const recent = stats?.recent || [];
  const {
    pageItems,
    page,
    pageSize,
    setPage,
    setPageSize,
    totalItems,
    totalPages,
  } = usePagination({
    items: recent,
    pageSize: 20,
    resetKey: windowId,
  });

  const events = logs?.events || [];
  const {
    pageItems: eventPageItems,
    page: eventPage,
    pageSize: eventPageSize,
    setPage: setEventPage,
    setPageSize: setEventPageSize,
    totalItems: eventTotalItems,
    totalPages: eventTotalPages,
  } = usePagination({
    items: events,
    pageSize: 20,
  });

  const w = stats?.windows?.[windowId];
  const pxpipeStatusView = getPxpipeStatusView(status || { loading }, health);
  const statusLabel = pxpipeStatusView.label;

  return (
    <div className={`space-y-6 ${embedded ? "" : "p-6"}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">image</span>
          PXPIPE Dashboard
        </h2>
        <div className="flex items-center gap-2">
          {!embedded && (
            <a href="/dashboard/token-saver/settings" className="text-xs text-primary underline hover:opacity-80">
              Token Saver settings
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Status"
          value={statusLabel}
          tone={health?.healthy
            ? "text-success"
            : pxpipeStatusView.error || status?.installed
              ? "text-warning"
              : "text-text-muted"}
          sub={pxpipeStatusView.error || (status?.enabled ? "Enabled in pipeline" : "Disabled in pipeline")}
        />
        <SummaryCard label="Version" value={status?.version ? `v${status.version}` : "—"} sub="pxpipe-proxy" />
        <SummaryCard label="Uptime" value={fmtUptime(status?.uptimeMs)} sub="module loaded" />
        <SummaryCard label="Requests" value={w ? w.requests.toLocaleString() : "—"} />
        <SummaryCard label="Compressed" value={w ? w.compressed.toLocaleString() : "—"} tone="text-success" />
        <SummaryCard label="Bypassed" value={w ? w.bypassed.toLocaleString() : "—"} />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-medium">Token savings (estimated)</h3>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
            {WINDOW_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setWindowId(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  windowId === tab.id
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:text-text hover:bg-bg-hover"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-text-muted">Original tokens</p>
            <p className="text-lg font-semibold">{w ? fmtTokens(w.tokensBeforeEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">After PXPIPE</p>
            <p className="text-lg font-semibold">{w ? fmtTokens(w.tokensAfterEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Saved</p>
            <p className="text-lg font-semibold text-success">{w ? fmtTokens(w.tokensSavedEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Reduction</p>
            <p className="text-lg font-semibold text-success">{w ? `${w.savedPct}%` : "—"}</p>
          </div>
        </div>
        <p className="text-xs text-text-muted mt-3">
          Estimates from body size before/after imaging; billed usage per request
          (recorded on the Usage page) remains the ground truth. Images generated:{" "}
          {w ? w.imagesGenerated.toLocaleString() : "—"} · avg compression time:{" "}
          {w ? `${w.avgCompressionMs}ms` : "—"} · errors: {w ? w.errors : "—"}
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="font-medium mb-3">Tokens saved — last 30 days</h3>
        {stats?.timeline?.some((d) => d.tokensSavedEst > 0) ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.timeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradPxpipe" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
              <Tooltip
                contentStyle={chartTooltipContentStyle}
                labelStyle={chartTooltipLabelStyle}
                itemStyle={chartTooltipItemStyle}
                formatter={(v) => [v == null ? "No PXPIPE activity" : `${fmtTokens(v)} tokens`, "Tokens saved"]}
                labelFormatter={(d) => d}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-32 flex items-center justify-center text-text-muted text-sm">
            No savings recorded yet — enable PXPIPE in the Token Saver and route a large Claude-format request.
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-medium mb-3">History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3 text-right">Original</th>
                <th className="py-2 pr-3 text-right">Compressed</th>
                <th className="py-2 pr-3 text-right">Saved</th>
                <th className="py-2 pr-3 text-right">%</th>
                <th className="py-2 pr-3 text-right">Duration</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((ev, i) => {
                const absoluteIndex = (page - 1) * pageSize + i;
                return (
                <tr key={`${ev.ts}-${absoluteIndex}`} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-text-muted">
                    {new Date(ev.ts).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{ev.provider ? `${ev.provider}/${ev.model}` : ev.model || "—"}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.applied ? fmtTokens(ev.tokensBeforeEst) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.applied ? fmtTokens(ev.tokensAfterEst) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs text-success">
                    {ev.applied ? fmtTokens(ev.tokensSavedEst) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.applied ? `${ev.savedPct}%` : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {ev.durationMs != null ? `${ev.durationMs}ms` : "—"}
                  </td>
                  <td className="py-1.5">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        ev.applied
                          ? "bg-success/15 text-success"
                          : ev.reason === "transform_error" || ev.reason === "timeout"
                            ? "bg-danger/15 text-danger"
                            : "bg-warning/15 text-warning"
                      }`}
                      title={ev.detail || ""}
                    >
                      {ev.applied ? "Compressed" : REASON_LABELS[ev.reason] || ev.reason}
                    </span>
                  </td>
                  </tr>
                );
              })}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-text-muted text-sm">
                    No PXPIPE activity yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <Pagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Card>

      <Card className="p-4" id="logs">
        <h3 className="font-medium mb-3">Transform events</h3>
        {events.length ? (
          <>
            <pre className="rounded bg-black/5 dark:bg-white/5 p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
              {eventPageItems.map(formatPxpipeEvent).join("\n")}
            </pre>
            {eventTotalPages > 1 && (
              <Pagination
                currentPage={eventPage}
                pageSize={eventPageSize}
                totalItems={eventTotalItems}
                onPageChange={setEventPage}
                onPageSizeChange={setEventPageSize}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted">No transform events yet.</p>
        )}
      </Card>
    </div>
  );
}

PxpipeClient.propTypes = {
  embedded: PropTypes.bool,
};
