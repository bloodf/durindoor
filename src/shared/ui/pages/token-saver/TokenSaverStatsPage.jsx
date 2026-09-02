import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/shared/ui/components/Badge.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import RangeSelector, { rangeLabel } from "@/shared/ui/components/RangeSelector.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";

import {
  bytesSavedSeries,
  headroomSkipReasons,
  historyRows,
  pxpipeSummary,
  saverStats,
  transformEvents,
} from "./mockData.js";

const historyColumns = [
  {
    key: "time",
    label: "Time",
    mono: true,
    width: "6rem",
    render: (row) => <time title={row.timestamp}>{row.time}</time>,
  },
  { key: "model", label: "Model", mono: true, width: "21%" },
  { key: "original", label: "Original", mono: true, align: "right" },
  { key: "compressed", label: "Compressed", mono: true, align: "right" },
  {
    key: "saved",
    label: "Saved",
    align: "right",
    render: (row) => <span className="font-mono text-xs text-dd-success dd-tnum">{row.saved}</span>,
  },
  { key: "reduction", label: "%", mono: true, align: "right" },
  { key: "duration", label: "Duration", mono: true, align: "right" },
  {
    key: "status",
    label: "Status",
    render: (row) => (
      <Badge tone={row.statusTone} size="sm" className="font-mono">
        {row.status}
      </Badge>
    ),
  },
];

const pxpipeMetrics = [
  { label: "Status", value: pxpipeSummary.status, tone: "text-dd-success" },
  { label: "Version", value: pxpipeSummary.version },
  { label: "Uptime", value: pxpipeSummary.uptime },
  { label: "Requests", value: pxpipeSummary.requests },
  { label: "Compressed", value: pxpipeSummary.compressed, tone: "text-dd-success" },
  { label: "Bypassed", value: pxpipeSummary.bypassed },
];

function formatMegabytes(value) {
  return `${Number(value).toFixed(1)} MB`;
}
function historyRowsForRange(range) {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const customDays = range.preset === "custom" && Number.isFinite(from) && Number.isFinite(to)
    ? Math.floor((to - from) / 86_400_000) + 1
    : null;
  const days = Number.isInteger(customDays) && customDays > 0
    ? customDays
    : { "1d": 1, "7d": 7, "15d": 15, "1m": 30, "3m": 90, "6m": 180, "12m": 365, all: Infinity }[range.preset] ?? 30;
  const rowCount = Math.min(historyRows.length, Math.max(1, Math.ceil((days / 30) * historyRows.length)));
  return historyRows.slice(0, rowCount);
}
const rangeConfig = {
  "1d": { points: 2, scale: 0.04 },
  "7d": { points: 7, scale: 0.23 },
  "15d": { points: 15, scale: 0.5 },
  "1m": { points: 30, scale: 1 },
  "3m": { points: 30, scale: 1.5 },
  "6m": { points: 30, scale: 2 },
  "12m": { points: 30, scale: 3 },
  all: { points: 30, scale: 4 },
  custom: { points: 15, scale: 0.5 },
};

function rangeData(range) {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const customDays = range.preset === "custom" && Number.isFinite(from) && Number.isFinite(to)
    ? Math.floor((to - from) / 86_400_000) + 1
    : null;
  const { points, scale } = Number.isInteger(customDays) && customDays > 0
    ? { points: Math.min(customDays, bytesSavedSeries.length), scale: customDays / 30 }
    : rangeConfig[range.preset] ?? rangeConfig["1m"];
  return {
    stats: saverStats.map((stat) => {
      const value = Number.parseFloat(stat.value.replaceAll(",", "")) * scale;
      const suffix = stat.value.replace(/[\d,.]/g, "");
      return { ...stat, value: suffix.includes("MB") ? `${value.toFixed(1)}${suffix}` : `${Math.round(value).toLocaleString()}${suffix}` };
    }),
    series: bytesSavedSeries.slice(-points).map((item) => ({ ...item, megabytes: Number((item.megabytes * scale).toFixed(1)) })),
  };
}

function BytesSavedChart({ series, label }) {
  return (
    <Card padding={false} className="min-w-0">
      <CardHeader
        icon="area_chart"
        title="Actual bytes saved"
        subtitle={`RTK output reduction plus non-negative Headroom body reduction · ${label}`}
      />
      <CardContent className="h-[300px] pb-3 pl-2 pr-4 pt-5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 8, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="tokenSaverBytesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--dd-accent)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--dd-accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--dd-border-subtle)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              interval={4}
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
              tickMargin={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
              tickFormatter={(value) => `${value} MB`}
              width={62}
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
              formatter={(value) => [formatMegabytes(value), "Actual bytes saved"]}
            />
            <Area
              type="monotone"
              dataKey="megabytes"
              stroke="var(--dd-accent)"
              strokeWidth={2}
              fill="url(#tokenSaverBytesFill)"
              activeDot={{ fill: "var(--dd-accent)", stroke: "var(--dd-surface)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function PxpipeEstimate() {
  return (
    <Card padding={false}>
      <CardHeader
        icon="image"
        title="pxpipe (image estimate)"
        subtitle="Image downsizing savings, kept separate from actual payload bytes"
      />
      <CardContent>
        <p className="font-mono text-3xl font-semibold text-dd-accent dd-tnum">286,880,863</p>
        <p className="mt-1 text-xs text-dd-subtle">Estimated tokens saved across 1,684 requests and 4,731 images</p>
      </CardContent>
    </Card>
  );
}

function SkipReasons() {
  return (
    <Card padding={false}>
      <CardHeader
        icon="rule"
        title="Headroom skip reasons"
        subtitle="Why Headroom did not compress a request"
      />
      <CardContent className="space-y-3">
        {headroomSkipReasons.map((item) => (
          <div key={item.reason} className="flex items-center justify-between gap-4">
            <span className="font-mono text-[13px] text-dd-muted">{item.reason}</span>
            <span className="flex items-baseline gap-3">
              <span className="font-mono text-sm font-semibold text-dd-text dd-tnum">{item.count}</span>
              <span className="w-12 text-right font-mono text-xs text-dd-subtle dd-tnum">{item.share}</span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PxpipeDashboard() {
  return (
    <Card padding={false}>
      <CardHeader
        icon="photo_size_select_large"
        title="PXPipe dashboard"
        subtitle="Image prompt compression health and estimated token reduction"
        actions={<Badge tone="success" size="sm" icon="check_circle">Pipeline healthy</Badge>}
      />
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {pxpipeMetrics.map((metric) => (
            <div key={metric.label} className="rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-dd-muted">{metric.label}</p>
              <p className={`mt-1 font-mono text-lg font-semibold dd-tnum ${metric.tone ?? "text-dd-text"}`}>
                {metric.value}
              </p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-dd-border-subtle pt-5 text-center md:grid-cols-4">
          <div>
            <p className="text-xs text-dd-muted">Original tokens</p>
            <p className="mt-1 font-mono text-lg font-semibold text-dd-text dd-tnum">{pxpipeSummary.originalTokens}</p>
          </div>
          <div>
            <p className="text-xs text-dd-muted">After PXPipe</p>
            <p className="mt-1 font-mono text-lg font-semibold text-dd-text dd-tnum">{pxpipeSummary.afterTokens}</p>
          </div>
          <div>
            <p className="text-xs text-dd-muted">Saved</p>
            <p className="mt-1 font-mono text-lg font-semibold text-dd-accent dd-tnum">{pxpipeSummary.savedTokens}</p>
          </div>
          <div>
            <p className="text-xs text-dd-muted">Reduction</p>
            <p className="mt-1 font-mono text-lg font-semibold text-dd-accent dd-tnum">{pxpipeSummary.reduction}</p>
          </div>
        </div>
        <p className="text-xs text-dd-subtle">
          Images generated: <span className="font-mono dd-tnum">{pxpipeSummary.images}</span>
          {" · "}average compression: <span className="font-mono dd-tnum">{pxpipeSummary.averageDuration}</span>
          {" · "}billed usage remains the source of truth.
        </p>
      </CardContent>
    </Card>
  );
}

export default function TokenSaverStatsPage({ initialRange = { preset: "1m" } }) {
  const [range, setRange] = useState(initialRange);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRowsPerPage, setHistoryRowsPerPage] = useState(25);
  const rangedHistoryRows = historyRowsForRange(range);
  const historyStart = historyRowsPerPage === "all" ? 0 : (historyPage - 1) * historyRowsPerPage;
  const visibleHistoryRows = historyRowsPerPage === "all" ? rangedHistoryRows : rangedHistoryRows.slice(historyStart, historyStart + historyRowsPerPage);
  const historyPageCount = historyRowsPerPage === "all" ? 1 : Math.ceil(rangedHistoryRows.length / historyRowsPerPage);
  const historyEnd = Math.min(historyStart + visibleHistoryRows.length, rangedHistoryRows.length);
  const historyRowsLabel = `Showing ${rangedHistoryRows.length === 0 ? 0 : historyStart + 1} to ${historyEnd} of ${rangedHistoryRows.length} results`;
  const { stats, series } = rangeData(range);
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="compress"
        title="Token Saver"
        subtitle="Compress prompts and outputs to save tokens"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-dd-text">Statistics</h2>
          <p className="text-xs text-dd-muted">Aggregate pre-provider compression metrics</p>
        </div>
        <RangeSelector value={range} onChange={setRange} size="sm" />
      </div>

      <section aria-label="Token Saver summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>

      <BytesSavedChart series={series} label={rangeLabel(range)} />

      <section aria-label="Compression breakdown" className="grid gap-4 lg:grid-cols-2">
        <PxpipeEstimate />
        <SkipReasons />
      </section>

      <PxpipeDashboard />

      <section className="space-y-3" aria-labelledby="pxpipe-history-title">
        <div>
          <h2 id="pxpipe-history-title" className="text-sm font-semibold text-dd-text">History</h2>
          <p className="mt-0.5 text-xs text-dd-muted">Recent PXPipe transforms and bypass decisions</p>
        </div>
        <DataTable
          columns={historyColumns}
          rows={visibleHistoryRows}
          keyFn={(row) => row.id}
          density="compact"
          pagination={{
            page: historyPage,
            pageCount: historyPageCount,
            total: rangedHistoryRows.length,
            rowsLabel: historyRowsLabel,
            onPage: setHistoryPage,
            rowsPerPage: historyRowsPerPage,
            onRowsPerPageChange: (value) => {
              setHistoryRowsPerPage(value);
              setHistoryPage(1);
            },
          }}
        />
      </section>

      <Card padding={false}>
        <CardHeader
          icon="terminal"
          title="Transform events"
          subtitle="Most recent PXPipe pipeline messages"
        />
        <CardContent>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-dd bg-dd-surface-2 p-4 font-mono text-xs leading-5 text-dd-muted">
            {transformEvents.join("\n")}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
