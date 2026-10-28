"use client";

import { useEffect, useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isNumber } from "@/shared/utils/typeChecks.js";
import SetupDiagnosticCard from "@/shared/components/SetupDiagnosticCard";
import Button from "@/shared/ui/components/Button.jsx";
import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";
import { chartTooltipContentStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "@/shared/components/chartTooltip";

export const formatBytes = (value) => { const n = Number(value) || 0; return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`; };
const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);

/** Source fields and period-keyed stream match TokenSaverOverview; bytes never become billed token claims. */
export default function SaverWidgets({ renderSections, period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false }) {
  const [localPeriod, setLocalPeriod] = useState("30d");
  const period = periodProp ?? localPeriod;
  const setPeriod = setPeriodProp ?? setLocalPeriod;
  const [stats, setStats] = useState(null);
  const [snapshotPeriod, setSnapshotPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [diagnostic, setDiagnostic] = useState(null);
  const chartId = useId();
  useEffect(() => {
    setLoading(true); setError("");
    let active = true;
    const stream = new EventSource(`/api/token-saver/stream?period=${period}`);
    stream.onerror = () => { if (!active) return; setLoading(false); setError("Token Saver stream is unavailable. Retry to reconnect."); };
    stream.onmessage = (event) => {
      if (!active) return;
      try { const data = JSON.parse(event.data); if (!data || !isNumber(data.requestsObserved) || !Number.isFinite(data.requestsObserved)) throw new Error("Invalid metrics"); setStats(data); setSnapshotPeriod(period); setLoading(false); setError(""); }
      catch { setLoading(false); setError("Token Saver returned an invalid metrics snapshot. Try again."); }
    };
    return () => { active = false; stream.close(); };
  }, [period, retry]);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/headroom/status", { headers: { "Cache-Control": "no-store" }, signal: abort.signal }).then((res) => res.ok ? res.json() : null).then((data) => { if (!abort.signal.aborted) setDiagnostic(data?.ok === false ? data.diagnostic : null); }).catch(() => {});
    return () => abort.abort();
  }, []);
  const rtk = stats?.rtk || {};
  const headroom = stats?.headroom || {};
  const pxpipe = stats?.pxpipe || {};
  const points = (stats?.dailyPoints || []).map((point) => ({ ...point, label: new Date(`${point.dateKey}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) }));
  const pending = error && !stats ? <p role="status">Token Saver metrics unavailable. Retry the stream above.</p> : loading && !stats ? <div className="v5-dashboard-skeleton" role="status">Loading Token Saver metrics</div> : !stats?.requestsObserved ? <div className="v5-dashboard-empty"><h3>No Token Saver events yet</h3><p>Send a request through DurinDoor after enabling RTK or Headroom.</p></div> : null;
  const sections = {
    "saver-summary": pending || <dl className="v5-dashboard-metrics">
      <div><dt>RTK bytes saved</dt><dd>{formatBytes(rtk.bytesSaved)}<span className="v5-dashboard-metric-hint">{number(rtk.requestsWithHits)} requests with {number(rtk.hits)} hits</span></dd></div>
      <div><dt>Headroom token delta</dt><dd>{number(headroom.tokensSaved)}<span className="v5-dashboard-metric-hint">{number(headroom.compressed)} compressed requests</span></dd></div>
      <div><dt>Actual payload shrink</dt><dd>{formatBytes(stats?.totals?.actualBytesSaved)}<span className="v5-dashboard-metric-hint">{formatBytes(headroom.bodyBytesBefore)} → {formatBytes(headroom.bodyBytesAfter)} Headroom body</span></dd></div>
      <div><dt>Headroom skipped</dt><dd>{number(headroom.skipped)}<span className="v5-dashboard-metric-hint">{number(headroom.phantomSavings)} sub-5% body shrink</span></dd></div>
    </dl>,
    "saver-bytes": pending || <div><p className="v5-dashboard-description">RTK output + Headroom body reduction.</p>{points.some((point) => point.actualBytesSaved > 0) ? <><div className="v5-dashboard-chart" role="img" aria-label="Actual bytes saved per day"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--dd-accent)" stopOpacity={0.14} /><stop offset="100%" stopColor="var(--dd-accent)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="var(--dd-border)" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--dd-text-muted)" }} /><YAxis tickFormatter={formatBytes} tick={{ fontSize: 11, fill: "var(--dd-text-muted)" }} width={70} /><Tooltip contentStyle={chartTooltipContentStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={formatBytes} /><Area type="monotone" dataKey="actualBytesSaved" stroke="var(--dd-accent)" fill={`url(#${chartId})`} strokeWidth={2} /></AreaChart></ResponsiveContainer></div><p className="sr-only">Actual bytes saved per day: {points.map((point) => `${point.dateKey}: ${formatBytes(point.actualBytesSaved)}`).join("; ")}</p></> : <p>No actual bytes saved in this period.</p>}</div>,
    "saver-estimate": pending || <div><p className="v5-dashboard-description">Estimated image tokens. Separate from actual bytes.</p><p className="v5-dashboard-value">{number(pxpipe.tokensSavedEst)}</p><p>{number(pxpipe.applied)} requests, {number(pxpipe.imageCount)} images</p></div>,
    "saver-skips": pending || <div><p className="v5-dashboard-description">Skipped compression by reason.</p>{Object.keys(headroom.skipReasons || {}).length ? <dl className="v5-dashboard-reasons">{Object.entries(headroom.skipReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => <div key={reason}><dt>{reason}</dt><dd>{number(count)}</dd></div>)}</dl> : <p>No skipped Headroom requests in this period.</p>}</div>,
  };
  return <div className="v5-dashboard-resource">{!hidePeriodSelector ? <div className="v5-dashboard-resource-toolbar"><p>Actual bytes · estimated image tokens</p><div className="v5-dashboard-period"><SegmentedControl aria-label="Token Saver period" options={USAGE_PERIOD_OPTIONS} value={period} onChange={setPeriod} size="sm" /></div></div> : null}{snapshotPeriod && snapshotPeriod !== period ? <p role="status" className="v5-dashboard-snapshot-period">Showing previous {USAGE_PERIOD_OPTIONS.find((option) => option.value === snapshotPeriod)?.label || snapshotPeriod} snapshot. {loading ? "Waiting for the selected period." : "Retry to load the selected period."}</p> : null}{diagnostic ? <SetupDiagnosticCard diagnostic={diagnostic} /> : null}{error ? <div className="v5-dashboard-error" role="alert"><p>{error}{stats ? " Previously received metrics remain visible." : ""}</p><Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry Token Saver stream</Button></div> : loading && stats ? <p role="status">Updating Token Saver metrics</p> : null}{renderSections ? renderSections(sections) : Object.entries(sections).map(([id, content]) => <section key={id}>{content}</section>)}</div>;
}
