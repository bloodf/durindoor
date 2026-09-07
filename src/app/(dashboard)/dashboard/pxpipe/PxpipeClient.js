"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import { usePagination } from "@/shared/hooks/usePagination";
import { formatPxpipeEvent, fmtTokens, PXPIPE_REASON_LABELS as REASON_LABELS } from "./formatPxpipeEvent.js";
import { getPxpipeStatusView, fetchPxpipeStatus } from "./pxpipeStatus.js";

const ROW_OPTIONS = [10, 25, 50, 100, "all"];

const WINDOW_TABS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7d", label: "7 days" },
  { value: "last30d", label: "30 days" },
  { value: "all", label: "All time" },
];

const fmtUptime = (ms) => {
  if (!ms || ms <= 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
};

function statusDotTone(status, health) {
  const view = getPxpipeStatusView(status, health);
  if (view.error) return "warning";
  if (health?.healthy) return "success";
  if (status?.installed) return "warning";
  return "neutral";
}

function statusToneToken(status, health) {
  const tone = statusDotTone(status, health);
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  return "default";
}

function eventTone(event) {
  if (event.applied) return "success";
  return event.reason === "transform_error" || event.reason === "timeout" ? "danger" : "warning";
}

function eventKey(event) {
  return [
    event?.id,
    event?.ts,
    event?.provider,
    event?.model,
    event?.applied,
    event?.reason,
    event?.tokensBeforeEst,
    event?.tokensAfterEst,
    event?.tokensSavedEst,
    event?.durationMs,
  ].map((value) => String(value ?? "")).join("|");
}

function SummaryCard({ label, value, sub, tone = "default", icon }) {
  return <StatCard icon={icon} label={label} value={value} hint={sub} tone={tone} />;
}

SummaryCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  sub: PropTypes.node,
  tone: PropTypes.oneOf(["default", "accent", "success", "warning", "danger"]),
  icon: PropTypes.string,
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
      fetch("/api/pxpipe/stats").then((response) => (response.ok ? response.json() : null)).catch(() => null),
      fetch("/api/pxpipe/logs?limit=50").then((response) => (response.ok ? response.json() : null)).catch(() => null),
      fetch("/api/pxpipe/health", { method: "POST" }).then((response) => (response.ok ? response.json() : null)).catch(() => null),
    ]);
    if (statusResult.status === "fulfilled" && statusResult.value) setStatus(statusResult.value);
    if (statsResult.status === "fulfilled") setStats(statsResult.value || null);
    if (logsResult.status === "fulfilled") setLogs(logsResult.value || null);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const recent = stats?.recent || [];
  const events = logs?.events || [];
  const history = usePagination({ items: recent, pageSize: 25, resetKey: windowId });
  const eventLog = usePagination({ items: events, pageSize: 25 });
  const windowStats = stats?.windows?.[windowId];
  const statusView = getPxpipeStatusView(status || { loading }, health);
  const dotTone = statusDotTone(status, health);

  const historyColumns = useMemo(() => [
    { key: "time", label: "Time", render: (event) => event.ts ? new Date(event.ts).toLocaleString() : "—" },
    { key: "model", label: "Model", mono: true, render: (event) => event.provider ? `${event.provider}/${event.model}` : event.model || "—" },
    { key: "original", label: "Original", align: "right", mono: true, render: (event) => event.applied ? fmtTokens(event.tokensBeforeEst) : "—" },
    { key: "compressed", label: "Compressed", align: "right", mono: true, render: (event) => event.applied ? fmtTokens(event.tokensAfterEst) : "—" },
    { key: "saved", label: "Saved", align: "right", mono: true, render: (event) => event.applied ? <span className="text-dd-success">{fmtTokens(event.tokensSavedEst)}</span> : "—" },
    { key: "percentage", label: "%", align: "right", mono: true, render: (event) => event.applied ? `${event.savedPct}%` : "—" },
    { key: "duration", label: "Duration", align: "right", mono: true, render: (event) => event.durationMs != null ? `${event.durationMs}ms` : "—" },
    { key: "status", label: "Status", render: (event) => <Badge tone={eventTone(event)} size="sm" title={event.detail || ""}>{event.applied ? "Compressed" : REASON_LABELS[event.reason] || event.reason || "Skipped"}</Badge> },
  ], []);

  return (
    <div className={`space-y-6 ${embedded ? "" : "p-4 sm:p-6"}`}>
      {!embedded ? (
        <PageHeader
          icon="image"
          title="PXPIPE Dashboard"
          subtitle="Compression activity and estimated token savings."
          actions={<>
            <a href="/dashboard/token-saver/settings" className="inline-flex min-h-11 items-center rounded-dd px-3 text-[13px] font-medium text-dd-accent outline-none hover:bg-dd-accent-soft focus-visible:shadow-dd-focus">Token Saver settings</a>
            <Button variant="secondary" icon="refresh" loading={loading} onClick={refresh}>Refresh</Button>
          </>}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-dd-text">PXPIPE Dashboard</h2>
          <Button variant="secondary" icon="refresh" loading={loading} onClick={refresh}>Refresh</Button>
        </div>
      )}

      <section aria-label="PXPIPE status summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          icon="monitor_heart"
          label="Status"
          value={<StatusDot tone={dotTone} pulse={statusView.label === "Running" || statusView.label === "Healthy"} label={statusView.label} />}
          tone={statusToneToken(status, health)}
          sub={statusView.error || (status?.enabled ? "Enabled in pipeline" : "Disabled in pipeline")}
        />
        <SummaryCard icon="sell" label="Version" value={status?.version ? `v${status.version}` : "—"} sub="pxpipe-proxy" />
        <SummaryCard icon="schedule" label="Uptime" value={fmtUptime(status?.uptimeMs)} sub="module loaded" />
        <SummaryCard icon="receipt_long" label="Requests" value={windowStats ? windowStats.requests.toLocaleString() : "—"} />
        <SummaryCard icon="compress" label="Compressed" value={windowStats ? windowStats.compressed.toLocaleString() : "—"} tone="success" />
        <SummaryCard icon="skip_next" label="Bypassed" value={windowStats ? windowStats.bypassed.toLocaleString() : "—"} />
      </section>

      <Card padding={false}>
        <CardHeader
          icon="savings"
          title="Token savings (estimated)"
          subtitle="PXPIPE estimates body size before and after imaging."
          actions={<SegmentedControl options={WINDOW_TABS} value={windowId} onChange={setWindowId} size="sm" aria-label="Savings time window" />}
        />
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
            <div>
              <p className="text-xs text-dd-muted">Original tokens</p>
              <p className="dd-tnum text-lg font-semibold text-dd-text">{windowStats ? fmtTokens(windowStats.tokensBeforeEst) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-dd-muted">After PXPIPE</p>
              <p className="dd-tnum text-lg font-semibold text-dd-text">{windowStats ? fmtTokens(windowStats.tokensAfterEst) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-dd-muted">Saved</p>
              <p className="dd-tnum text-lg font-semibold text-dd-success">{windowStats ? fmtTokens(windowStats.tokensSavedEst) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-dd-muted">Reduction</p>
              <p className="dd-tnum text-lg font-semibold text-dd-success">{windowStats ? `${windowStats.savedPct}%` : "—"}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-dd-muted">
            Estimates come from body size before and after imaging. Billed Usage-page values remain ground truth. Images generated: {windowStats ? windowStats.imagesGenerated.toLocaleString() : "—"} · Average compression time: {windowStats ? `${windowStats.avgCompressionMs}ms` : "—"} · Errors: {windowStats ? windowStats.errors : "—"}
          </p>
        </CardContent>
      </Card>

      <Card padding={false} className="min-w-0">
        <CardHeader icon="area_chart" title="Tokens saved — last 30 days" subtitle="Daily estimated savings from PXPIPE." />
        <CardContent>
          {stats?.timeline?.some((point) => point.tokensSavedEst > 0) ? (
            <>
              <div className="h-56" role="img" aria-label="Area chart of PXPIPE tokens saved over the last 30 days">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.timeline} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                    <rect width="100%" height="100%" fill="var(--dd-surface)" />
                    <defs>
                      <linearGradient id="pxpipeTokensFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--dd-accent)" stopOpacity={0.14} />
                        <stop offset="100%" stopColor="var(--dd-accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--dd-border-subtle)" strokeDasharray="3 3" vertical={false} />
                    <Area type="monotone" dataKey="tokensSavedEst" stroke="var(--dd-accent)" strokeWidth={2} fill="url(#pxpipeTokensFill)" activeDot={{ fill: "var(--dd-accent)", stroke: "var(--dd-surface)", strokeWidth: 2 }} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }} tickMargin={10} tickFormatter={(date) => date.slice(5)} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }} tickFormatter={fmtTokens} width={52} />
                    <Tooltip
                      cursor={{ stroke: "var(--dd-border)" }}
                      contentStyle={{ background: "var(--dd-surface-3)", border: "1px solid var(--dd-border)", borderRadius: "var(--dd-radius)", color: "var(--dd-text)", fontSize: 12 }}
                      formatter={(value) => [value == null ? "No PXPIPE activity" : `${fmtTokens(value)} tokens`, "Tokens saved"]}
                      labelFormatter={(date) => date}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="sr-only">Tokens saved per day: {stats.timeline.map((point) => `${point.date}: ${fmtTokens(point.tokensSavedEst)} tokens`).join("; ")}</p>
            </>
          ) : (
            <div className="flex min-h-32 items-center justify-center text-center text-[13px] text-dd-muted">
              No savings recorded yet — enable PXPIPE in Token Saver and route a large Claude-format request.
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="pxpipe-history-title" className="space-y-3">
        <div>
          <h2 id="pxpipe-history-title" className="text-lg font-semibold text-dd-text">History</h2>
          <p className="text-[13px] text-dd-muted">Recent PXPIPE compression decisions.</p>
        </div>
        <DataTable
          columns={historyColumns}
          rows={history.pageItems}
          keyFn={eventKey}
          density="compact"
          loading={loading}
          caption="PXPIPE compression history"
          emptyState={{ icon: "history", title: "No PXPIPE activity yet", message: "Compression decisions appear here after requests pass through the pipeline." }}
          pagination={{
            page: history.page,
            pageCount: history.totalPages,
            total: history.totalItems,
            rowsPerPage: history.pageSize,
            rowsPerPageOptions: ROW_OPTIONS,
            onPage: history.setPage,
            onRowsPerPageChange: history.setPageSize,
            rowsLabel: `Showing ${history.pageItems.length} of ${history.totalItems.toLocaleString()} compression events`,
          }}
        />
      </section>

      <Card padding={false} id="logs">
        <CardHeader icon="terminal" title="Transform events" subtitle="Raw events emitted by PXPIPE." />
        <CardContent>
          {events.length ? (
            <>
              <pre tabIndex={0} aria-label="PXPIPE transform events" className="max-h-64 overflow-auto rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3 font-mono text-xs text-dd-text whitespace-pre-wrap" role="region">
                {eventLog.pageItems.map(formatPxpipeEvent).join("\n")}
              </pre>
              {eventLog.totalPages > 1 ? (
                <div className="mt-3">
                  <Pagination
                    page={eventLog.page}
                    pageCount={eventLog.totalPages}
                    total={eventLog.totalItems}
                    rowsPerPage={eventLog.pageSize}
                    rowsPerPageOptions={ROW_OPTIONS}
                    onPage={eventLog.setPage}
                    onRowsPerPageChange={eventLog.setPageSize}
                    rowsLabel={`Showing ${eventLog.pageItems.length} of ${eventLog.totalItems.toLocaleString()} transform events`}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-28 items-center justify-center text-[13px] text-dd-muted">No transform events yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

PxpipeClient.propTypes = { embedded: PropTypes.bool };
