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
import { formatCompactToken } from "@/shared/utils/formatCompact";
import { createLatestRequestGuard } from "@/shared/utils/requestFreshness";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import Button from "@/shared/ui/components/Button.jsx";

// Chart labels use the same compact units as the other usage surfaces.
export const fmtTokens = (n) => formatCompactToken(n).display;

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
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [requestGuard] = useState(createLatestRequestGuard);
  const uiV5 = useUiV5();

  const fetchData = useCallback(async (signal, requestToken) => {
    setLoading(true);
    if (uiV5) setError(false);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/usage/chart?period=${encodeURIComponent(period)}&tz=${encodeURIComponent(tz)}`, { signal });
      if (!uiV5) {
        if (res.ok) {
          const json = await res.json();
          if (!signal.aborted && requestToken.isCurrent()) setData(json);
        }
        return;
      }
      if (!res.ok) throw new Error(`Usage chart request failed: ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error("Usage chart response must be an array");
      if (!signal.aborted && requestToken.isCurrent()) setData(json);
    } catch (e) {
      if (e?.name !== "AbortError" && !signal.aborted && requestToken.isCurrent()) {
        if (uiV5) setError(true);
        else console.error("Failed to fetch chart data:", e);
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [period, refreshKey, retryNonce, uiV5]);

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
      {uiV5 && error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-dd border border-dd-danger/30 p-3 text-dd-danger"><div><p>Unable to load usage chart.</p>{data.length > 0 ? <p className="text-dd-muted">Showing the last loaded chart data.</p> : null}</div><Button variant="secondary" size="sm" onClick={() => setRetryNonce((value) => value + 1)}>Retry chart</Button></div> : null}
      {uiV5 && loading && data.length > 0 ? <p role="status" className="text-dd-muted">Updating usage chart…</p> : null}
      {loading && (!uiV5 || data.length === 0) ? (
        <div className="flex h-48 items-center justify-center text-[13px] text-dd-muted">Loading…</div>
      ) : uiV5 && error && data.length === 0 ? null : !hasData ? (
        <div className="flex h-48 items-center justify-center text-[13px] text-dd-muted">No data for this period</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--dd-accent)" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="var(--dd-accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--dd-accent-2)" stopOpacity={0.14} />
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
