import React, { useState } from "react";
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
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import RangeSelector from "@/shared/ui/components/RangeSelector.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";

import { headroomStats, recentEvents, tokensSavedSeries } from "./mockData.js";

const eventColumns = [
  {
    key: "time",
    label: "Time",
    mono: true,
    render: (row) => <time title={row.timestamp}>{row.time}</time>,
  },
  { key: "model", label: "Provider/Model", mono: true, width: "34%" },
  {
    key: "result",
    label: "Result",
    render: (row) => <Badge tone={row.tone} size="sm">{row.result}</Badge>,
  },
  { key: "tokensBefore", label: "Tokens before", mono: true, align: "right" },
  { key: "tokensSaved", label: "Tokens saved", mono: true, align: "right" },
];

function compactNumber(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

const RANGE_PRESETS = {
  "1d": { count: 1, scale: 0.18 },
  "7d": { count: 2, scale: 0.32 },
  "15d": { count: 3, scale: 0.45 },
  "1m": { count: 4, scale: 0.58 },
  "3m": { count: 5, scale: 0.72 },
  "6m": { count: 6, scale: 0.86 },
  "12m": { count: 7, scale: 0.94 },
  all: { count: 8, scale: 1 },
};

const STAT_BASES = {
  "Total requests": 50700,
  Compressed: 23100,
  "Tokens saved": 12870000,
  Errors: 52,
};

function rangeData(value) {
  if (value.preset !== "custom") return RANGE_PRESETS[value.preset] ?? RANGE_PRESETS["7d"];

  const from = new Date(`${value.from}T00:00:00Z`);
  const to = new Date(`${value.to}T00:00:00Z`);
  const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
  return {
    count: Math.min(tokensSavedSeries.length, Math.max(1, days)),
    scale: Math.min(1, Math.max(0.18, days / 30)),
  };
}

function scaledStat(stat, scale) {
  const base = STAT_BASES[stat.label];
  if (base === undefined) return stat;
  const scaled = Math.round(base * scale);
  return {
    ...stat,
    value: stat.label === "Tokens saved" ? compactNumber(scaled) : scaled.toLocaleString(),
  };
}

export default function HeadroomPage({ initialRange = { preset: "7d" } }) {
  const [enabled, setEnabled] = useState(true);
  const [compressUserMessages, setCompressUserMessages] = useState(true);
  const [range, setRange] = useState(initialRange);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const { count, scale } = rangeData(range);
  const stats = headroomStats.map((stat) => scaledStat(stat, scale));
  const chartData = tokensSavedSeries
    .slice(-count)
    .map((point) => ({ ...point, tokens: Math.round(point.tokens * scale) }));
  const events = recentEvents.slice(0, count);
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(events.length / rowsPerPage));
  const visibleEvents = rowsPerPage === "all"
    ? events
    : events.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const firstVisibleEvent = events.length === 0 ? 0 : rowsPerPage === "all" ? 1 : (page - 1) * rowsPerPage + 1;
  const lastVisibleEvent = rowsPerPage === "all"
    ? events.length
    : Math.min(page * rowsPerPage, events.length);
  const rowsLabel = `Showing ${firstVisibleEvent} to ${lastVisibleEvent} of ${events.length} results`;

  function handleRangeChange(value) {
    setRange(value);
    setPage(1);
  }

  function handleRowsPerPageChange(value) {
    setRowsPerPage(value);
    setPage(1);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="compress"
        title="Headroom Dashboard"
        subtitle="Compress outgoing chat messages via the Headroom proxy"
        actions={
          <>
            <a
              href="/dashboard/token-saver/settings"
              className="rounded-dd px-2 py-1 text-[13px] font-medium text-dd-accent outline-none hover:text-dd-accent-hover focus-visible:shadow-dd-focus"
            >
              Token Saver settings
            </a>
            <Button variant="ghost" icon="refresh">Refresh</Button>
          </>
        }
      />

      <Card padding={false}>
        <CardHeader icon="tune" title="Compression settings" subtitle="Control which outgoing messages use Headroom" />
        <div className="divide-y divide-dd-border-subtle">
          <div className="px-5 py-4">
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              label="Enable Headroom"
              description="Route supported outgoing chat requests through the Headroom proxy."
            />
          </div>
          <div className="px-5 py-4">
            <Toggle
              checked={compressUserMessages}
              onChange={setCompressUserMessages}
              label="Compress user messages"
              description="Include user-authored message content when reducing prompt size."
            />
          </div>
        </div>
      </Card>

      <section aria-label="Headroom summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>
      <p className="-mt-3 text-xs text-dd-subtle">
        Saved tokens are as reported by the Headroom proxy.
      </p>

      <Card padding={false} className="min-w-0">
        <CardHeader
          icon="area_chart"
          title="Tokens saved per day"
          subtitle="Headroom-reported compression savings"
          actions={
            <RangeSelector value={range} onChange={handleRangeChange} size="sm" />
          }
        />
        <CardContent className="h-[320px] pb-3 pl-2 pr-4 pt-5">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="headroomTokensFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--dd-accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--dd-accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--dd-border-subtle)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
                tickMargin={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
                tickFormatter={compactNumber}
                width={52}
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
                formatter={(value) => [Number(value).toLocaleString(), "Tokens saved"]}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="var(--dd-accent)"
                strokeWidth={2}
                fill="url(#headroomTokensFill)"
                activeDot={{ fill: "var(--dd-accent)", stroke: "var(--dd-surface)", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="recent-events-title">
        <div>
          <h2 id="recent-events-title" className="text-base font-semibold text-dd-text">Recent events</h2>
          <p className="text-[13px] text-dd-muted">Latest Headroom compression decisions and outcomes</p>
        </div>
        <DataTable
          columns={eventColumns}
          rows={visibleEvents}
          keyFn={(row) => row.id}
          density="compact"
          pagination={{
            page,
            pageCount,
            total: events.length,
            rowsLabel,
            onPage: setPage,
            rowsPerPage,
            onRowsPerPageChange: handleRowsPerPageChange,
          }}
        />
      </section>
    </div>
  );
}
