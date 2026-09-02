import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

const providerOptions = [
  { value: "all", label: "All providers" },
  { value: "codex", label: "codex" },
  { value: "ollama-local", label: "ollama-local" },
  { value: "claude", label: "claude" },
  { value: "minimax", label: "minimax" },
  { value: "kimi", label: "kimi" },
  { value: "xai", label: "xai" },
  { value: "cc", label: "cc" },
];

const statusOptions = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "ok", label: "Ok" },
  { value: "aborted", label: "Aborted" },
  { value: "error", label: "Error" },
];

const statusMeta = [
  { status: "ok", label: "Ok", tone: "success", color: "var(--dd-success)" },
  { status: "running", label: "Running", tone: "info", color: "var(--dd-info)" },
  { status: "aborted", label: "Aborted", tone: "warning", color: "var(--dd-warning)" },
  { status: "error", label: "Error", tone: "danger", color: "var(--dd-danger)" },
];

const statusTone = Object.fromEntries(statusMeta.map(({ status, tone }) => [status, tone]));
const bucketMs = 5 * 60 * 1000;

/** Builds a stable last-hour series by summing filtered-row events into 5-minute buckets. */
function requestSeries(rows) {
  if (rows.length === 0) return [];

  const timedRows = rows
    .map((row) => ({ ...row, timestamp: Date.parse(row.startedAt) }))
    .filter((row) => Number.isFinite(row.timestamp));
  if (timedRows.length === 0) return [];

  const latestBucket = Math.floor(Math.max(...timedRows.map((row) => row.timestamp)) / bucketMs) * bucketMs;
  const firstBucket = latestBucket - 11 * bucketMs;
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const timestamp = firstBucket + index * bucketMs;
    return {
      timestamp,
      time: new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      events: 0,
      runningEvents: 0,
    };
  });

  timedRows.forEach((row) => {
    const index = Math.floor((row.timestamp - firstBucket) / bucketMs);
    if (index < 0 || index >= buckets.length) return;
    buckets[index].events += row.events;
    if (row.status === "running") buckets[index].runningEvents += row.events;
  });

  return buckets;
}

function RequestsChart({ rows }) {
  const data = useMemo(() => requestSeries(rows), [rows]);
  const runningPeak = data.reduce(
    (peak, bucket) => (bucket.runningEvents > (peak?.runningEvents ?? 0) ? bucket : peak),
    null,
  );

  return (
    <Card padding={false} className="min-w-0">
      <CardHeader
        icon="area_chart"
        title="Requests over time"
        subtitle="Gateway events in 5-minute buckets · filtered rows"
        actions={
          runningPeak ? (
            <Badge tone="info" size="sm">
              <StatusDot tone="info" pulse />
              Running burst
            </Badge>
          ) : null
        }
      />
      <CardContent className="h-[260px] pb-3 pl-2 pr-4 pt-5">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-dd-muted">No chart data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="timelineRequestsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--dd-accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--dd-accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--dd-border-subtle)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
                tickMargin={10}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
                width={36}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--dd-border)" }}
                contentStyle={{
                  background: "var(--dd-surface-3)",
                  border: "1px solid var(--dd-border)",
                  borderRadius: "var(--dd-radius)",
                  color: "var(--dd-text)",
                  fontSize: 12,
                }}
                formatter={(value) => [Number(value).toLocaleString(), "Events"]}
              />
              <Area
                type="monotone"
                dataKey="events"
                stroke="var(--dd-accent)"
                strokeWidth={2}
                fill="url(#timelineRequestsFill)"
                activeDot={{ fill: "var(--dd-accent)", stroke: "var(--dd-surface)", strokeWidth: 2 }}
              />
              {runningPeak ? (
                <ReferenceDot
                  x={runningPeak.time}
                  y={runningPeak.events}
                  r={5}
                  fill="var(--dd-info)"
                  stroke="var(--dd-surface)"
                  strokeWidth={2}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function StatusMix({ rows }) {
  const total = rows.length;
  const items = statusMeta.map((item) => {
    const count = rows.filter((row) => row.status === item.status).length;
    return { ...item, count, percentage: total === 0 ? 0 : Math.round((count / total) * 100) };
  });

  return (
    <Card padding={false}>
      <CardHeader icon="donut_large" title="Status mix" subtitle={`${total} filtered requests`} />
      <CardContent className="flex h-[260px] flex-col justify-center gap-4">
        {items.map((item) => (
          <div key={item.status} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs">
              <StatusDot tone={item.tone} pulse={item.status === "running" && item.count > 0} />
              <span className="font-medium text-dd-text">{item.label}</span>
              <span className="ml-auto font-mono text-dd-muted dd-tnum">
                {item.count} · {item.percentage}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-dd bg-dd-surface-3">
              <div
                className="h-full rounded-dd transition-[width]"
                style={{ backgroundColor: item.color, width: `${item.percentage}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ConnectionId({ value }) {
  return (
    <span className="group inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-dd-muted" title={value}>
        {value.slice(0, 8)}…
      </span>
      <button
        type="button"
        aria-label={`Copy connection ID ${value}`}
        title="Copy connection ID"
        onClick={() => navigator.clipboard?.writeText(value)}
        className="flex size-6 items-center justify-center rounded-dd text-dd-subtle opacity-0 outline-none transition-opacity hover:bg-dd-surface-3 hover:text-dd-text focus-visible:opacity-100 focus-visible:shadow-dd-focus group-hover:opacity-100"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[15px] leading-none">
          content_copy
        </span>
      </button>
    </span>
  );
}

const columns = [
  {
    key: "started",
    label: "Started",
    width: "7rem",
    render: (row) => (
      <span className="dd-tnum whitespace-nowrap text-xs text-dd-muted" title={row.startedAt}>
        {row.started}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    width: "7rem",
    render: (row) => (
      <Badge tone={statusTone[row.status]} size="sm">
        {row.status === "running" ? <StatusDot tone="info" pulse /> : null}
        <span className="capitalize">{row.status}</span>
      </Badge>
    ),
  },
  {
    key: "provider",
    label: "Provider",
    width: "10rem",
    render: (row) => (
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <ProviderLogo provider={row.provider} size={16} />
        <span>{row.provider}</span>
      </span>
    ),
  },
  { key: "model", label: "Model", mono: true },
  {
    key: "connection",
    label: "Connection",
    width: "9rem",
    render: (row) => <ConnectionId value={row.connection} />,
  },
  { key: "events", label: "Events", align: "right", width: "5rem" },
  { key: "fallbacks", label: "Fallbacks", align: "right", width: "6rem" },
  {
    key: "duration",
    label: "ms",
    align: "right",
    width: "6rem",
    render: (row) => row.duration.toLocaleString(),
  },
];

export default function TimelinePage({
  rows = [],
  provider = "all",
  status = "all",
  model = "",
  live = true,
  onProviderChange,
  onStatusChange,
  onModelChange,
  onLiveChange,
  loading = false,
}) {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = useMemo(() => {
    if (rowsPerPage === "all") return rows;

    const start = (currentPage - 1) * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [currentPage, rows, rowsPerPage]);
  const firstVisibleRow = rows.length === 0 ? 0 : rowsPerPage === "all" ? 1 : (currentPage - 1) * rowsPerPage + 1;
  const lastVisibleRow = rowsPerPage === "all" ? rows.length : Math.min(currentPage * rowsPerPage, rows.length);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        icon="timeline"
        title="Timeline"
        subtitle="Live redacted proxy hops and client frames"
      />
      <section aria-label="Timeline analytics" className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <RequestsChart rows={rows} />
        </div>
        <StatusMix rows={rows} />
      </section>
      <DataTable
        columns={columns}
        rows={visibleRows}
        keyFn={(row) => row.id}
        density="compact"
        loading={loading}
        filterBar={
          <>
            <Select
              size="sm"
              className="w-40"
              value={provider}
              onChange={onProviderChange}
              options={providerOptions}
              aria-label="Filter by provider"
            />
            <Select
              size="sm"
              className="w-36"
              value={status}
              onChange={onStatusChange}
              options={statusOptions}
              aria-label="Filter by status"
            />
            <Input
              size="sm"
              icon="search"
              className="w-56"
              value={model}
              onChange={(event) => onModelChange?.(event.target.value)}
              placeholder="Filter by model…"
              aria-label="Filter by model"
            />
            <div className="ml-auto flex items-center gap-2 rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2.5 py-1">
              <StatusDot tone={live ? "success" : "neutral"} pulse={live} />
              <span className="text-xs font-medium text-dd-muted">Live</span>
              <Toggle
                size="sm"
                checked={live}
                onChange={onLiveChange}
                aria-label="Toggle live updates"
              />
            </div>
          </>
        }
        emptyState={{
          icon: "filter_alt_off",
          title: "No timeline events",
          message: "No proxy hops match the selected filters.",
        }}
        pagination={
          loading
            ? undefined
            : {
                page: currentPage,
                pageCount,
                total: rows.length,
                rowsLabel: `Showing ${firstVisibleRow} to ${lastVisibleRow} of ${rows.length} results`,
                onPage: setPage,
                rowsPerPage,
                onRowsPerPageChange: (value) => {
                  setRowsPerPage(value);
                  setPage(1);
                },
              }
            }
      />
    </div>
  );
}
