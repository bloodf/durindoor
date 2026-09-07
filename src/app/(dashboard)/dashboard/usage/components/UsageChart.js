"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/shared/ui/components/Card.jsx";
import { chartTooltipContentStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "@/shared/components/chartTooltip";
import { createLatestRequestGuard } from "@/shared/utils/requestFreshness";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

/**
 * Upstream #3388: refetch persisted chart data when the stable request count changes.
 * Durin DS: one dual-axis area chart (tokens = `--dd-accent`, cost = `--dd-accent-2`)
 * instead of a tabbed tokens/cost sub-graph switch (golden rule #7). A visually-hidden
 * table mirrors the same series for assistive tech and non-visual consumption.
 */
export default function UsageChart({ period = "7d", refreshKey = 0 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestGuard] = useState(createLatestRequestGuard);

  const fetchData = useCallback(async (signal, requestToken) => {
    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/usage/chart?period=${encodeURIComponent(period)}&tz=${encodeURIComponent(tz)}`, { signal });
      if (res.ok) {
        const json = await res.json();
        if (!signal.aborted && requestToken.isCurrent()) setData(json);
      }
    } catch (e) {
      if (e?.name !== "AbortError") console.error("Failed to fetch chart data:", e);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [period, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const requestToken = requestGuard.begin();
    fetchData(controller.signal, requestToken);
    return () => {
      controller.abort();
      requestToken.cancel();
    };
  }, [fetchData, requestGuard]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

  return (
    <Card padding={false} className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-dd-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-dd-accent" />
          Tokens
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-dd-accent-2" />
          Cost
        </span>
      </div>
      {loading ? (
        <div className="flex h-48 items-center justify-center text-[13px] text-dd-muted">Loading…</div>
      ) : !hasData ? (
        <div className="flex h-48 items-center justify-center text-[13px] text-dd-muted">No data for this period</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--dd-accent)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--dd-accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--dd-accent-2)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--dd-accent-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--dd-border)" strokeDasharray="3 3" strokeOpacity={0.6} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--dd-text-muted)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="tokens"
                tick={{ fontSize: 10, fill: "var(--dd-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtTokens}
                width={56}
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                tick={{ fontSize: 10, fill: "var(--dd-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtCost}
                width={64}
              />
              <Tooltip
                contentStyle={chartTooltipContentStyle}
                labelStyle={chartTooltipLabelStyle}
                itemStyle={chartTooltipItemStyle}
                formatter={(value, name) =>
                  name === "tokens" ? [fmtTokens(value), "Tokens"] : [fmtCost(value), "Cost"]
                }
              />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="tokens"
                stroke="var(--dd-accent)"
                strokeWidth={2}
                fill="url(#gradTokens)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                yAxisId="cost"
                type="monotone"
                dataKey="cost"
                stroke="var(--dd-accent-2)"
                strokeWidth={2}
                fill="url(#gradCost)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
          <dl className="sr-only" aria-label="Usage totals per interval">
            {data.map((point) => (
              <div key={point.label}>
                <dt>{point.label}</dt>
                <dd>{fmtTokens(point.tokens)} tokens, {fmtCost(point.cost)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  refreshKey: PropTypes.number,
};
