"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/shared/components";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";
import { chartTooltipContentStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "@/shared/components/chartTooltip";

const bytes = (value) => {
  const n = Number(value) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);

function StatCard({ label, value, detail, tone = "text-text" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-text-muted">{detail}</p>
    </Card>
  );
}

// Aggregate Token Saver overview (port of decolua/9router #2562). Streams the
// period aggregate from /api/token-saver/stream and charts per-day actual
// bytes saved. pxpipe is shown separately as an estimate (image billing
// model), never folded into the actual-bytes total.
export default function TokenSaverOverview() {
  const [period, setPeriod] = useState("30d");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const stream = new EventSource(`/api/token-saver/stream?period=${period}`);
    stream.onerror = () => setLoading(false);
    stream.onmessage = (event) => {
      try {
        setStats(JSON.parse(event.data));
        setLoading(false);
      } catch {}
    };
    return () => stream.close();
  }, [period]);

  const rtk = stats?.rtk || {};
  const headroom = stats?.headroom || {};
  const pxpipe = stats?.pxpipe || {};
  const points = (stats?.dailyPoints || []).map((point) => ({
    ...point,
    label: new Date(`${point.dateKey}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));
  const skipReasons = Object.entries(headroom.skipReasons || {}).sort((a, b) => b[1] - a[1]);
  const isEmpty = !stats?.requestsObserved;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-text-muted">Aggregate pre-provider compression metrics. No provider billing estimate.</p>
        </div>
        <div className="flex flex-wrap rounded-lg border border-border bg-surface-2 p-1">
          {USAGE_PERIOD_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${period === value ? "bg-primary text-white" : "text-text-muted hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-muted">Loading Token Saver metrics…</Card>
      ) : isEmpty ? (
        <Card className="p-8 text-center text-sm text-text-muted">No Token Saver events yet. Send a request through DurinDoor after enabling RTK or Headroom.</Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="RTK bytes saved" value={bytes(rtk.bytesSaved)} detail={`${number(rtk.requestsWithHits)} requests with ${number(rtk.hits)} hits`} tone="text-success" />
            <StatCard label="Headroom token delta" value={number(headroom.tokensSaved)} detail={`${number(headroom.compressed)} compressed requests; reported by Headroom`} tone="text-primary" />
            <StatCard label="Actual payload shrink" value={bytes(stats?.totals?.actualBytesSaved)} detail={`${bytes(headroom.bodyBytesBefore)} → ${bytes(headroom.bodyBytesAfter)} Headroom body`} />
            <StatCard label="Headroom skipped" value={number(headroom.skipped)} detail={`${number(headroom.phantomSavings)} sub-5% body shrink (phantom)`} tone={headroom.skipped || headroom.phantomSavings ? "text-warning" : "text-text"} />
          </div>

          <Card className="p-4">
            <div className="mb-3">
              <h3 className="font-medium">Actual bytes saved</h3>
              <p className="text-xs text-text-muted">RTK output reduction plus non-negative Headroom body reduction.</p>
            </div>
            {points.some((point) => point.actualBytesSaved > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tokenSaverBytes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary, #6366f1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary, #6366f1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="rgba(148,163,184,0.4)" />
                  <YAxis tickFormatter={bytes} tick={{ fontSize: 11 }} stroke="rgba(148,163,184,0.4)" width={70} />
                  <Tooltip
                    contentStyle={chartTooltipContentStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value) => bytes(value)}
                  />
                  <Area type="monotone" dataKey="actualBytesSaved" stroke="var(--color-primary, #6366f1)" fill="url(#tokenSaverBytes)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-32 flex items-center justify-center text-text-muted text-sm">
                No actual bytes saved in this period yet.
              </div>
            )}
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="font-medium mb-1">pxpipe (image estimate)</h3>
              <p className="text-xs text-text-muted mb-3">Estimated token savings from image downsizing. Separate from actual bytes.</p>
              <p className="text-2xl font-semibold text-text">{number(pxpipe.tokensSavedEst)}</p>
              <p className="text-xs text-text-muted mt-1">{number(pxpipe.applied)} requests, {number(pxpipe.imageCount)} images</p>
            </Card>

            <Card className="p-4">
              <h3 className="font-medium mb-1">Headroom skip reasons</h3>
              <p className="text-xs text-text-muted mb-3">Why Headroom did not compress a request.</p>
              {skipReasons.length ? (
                <ul className="space-y-1">
                  {skipReasons.map(([reason, count]) => (
                    <li key={reason} className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">{reason}</span>
                      <span className="font-medium">{number(count)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">No skipped Headroom requests in this period.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
