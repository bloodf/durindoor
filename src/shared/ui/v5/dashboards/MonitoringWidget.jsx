"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isString } from "@/shared/utils/typeChecks.js";
import Button from "@/shared/ui/components/Button.jsx";
import MotionIcon from "../motion/MotionIcon.jsx";

const REFRESH_MS = 10000;
const num = (value) => value == null ? "—" : Number(value).toLocaleString();
const basename = (path) => isString(path) ? path.split(/[\\/]/).filter(Boolean).pop() : "—";
function uptime(value) {
  if (value == null) return "—";
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** All measured fields match MonitoringPage; local controls omit page chrome inside a widget. */
export default function MonitoringWidget() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [lastAt, setLastAt] = useState(null);
  const requests = useRef({ epoch: 0, controller: null });
  const load = useCallback(async () => {
    const state = requests.current;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const epoch = ++state.epoch;
    setLoading(true);
    try {
      const response = await fetch("/api/monitoring", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json();
      if (!next?.runtime || !next?.activity) throw new Error("Invalid monitoring snapshot");
      if (!controller.signal.aborted && epoch === state.epoch) { setData(next); setError(""); setLastAt(new Date()); }
    } catch (failure) {
      if (!controller.signal.aborted && epoch === state.epoch) setError(failure.message || "Failed to load monitoring status");
    } finally { if (!controller.signal.aborted && epoch === state.epoch) setLoading(false); }
  }, []);
  useEffect(() => { const state = requests.current; load(); return () => { state.epoch++; state.controller?.abort(); }; }, [load]);
  useEffect(() => { if (!auto) return undefined; const timer = setInterval(load, REFRESH_MS); return () => clearInterval(timer); }, [auto, load]);
  const runtime = data?.runtime || {};
  const today = data?.activity?.today || {};
  const groups = [
    { icon: "dns", title: "Gateway", value: data ? error ? "Snapshot unavailable" : "Online" : "—", rows: [["Latency", data ? `${data.latencyMs} ms` : "—"], ["Version", data?.version || "—"], ["Uptime", uptime(runtime.processUptimeSec)], ["Node", runtime.nodeVersion || "—"]] },
    { icon: "bar_chart", title: "Activity (24h)", value: num(today.requests), rows: [["Prompt tokens", num(today.promptTokens)], ["Completion tokens", num(today.completionTokens)], ["Active providers", num(today.providers)], ["Models used", num(today.models)]] },
    { icon: "speed", title: "Gateway latency", value: data ? `${data.latencyMs} ms` : "—", rows: [["Version", data?.version || "—"], ["Memory", runtime.memoryRssMB != null ? `${runtime.memoryRssMB} MB` : "—"], ["Last error", runtime.errorProvider || "—"], ["Updated", lastAt ? lastAt.toLocaleTimeString() : "—"]] },
    { icon: "storage", title: "Storage", value: runtime.dbSizeLabel || "—", rows: [["Type", "SQLite"], ["File", basename(runtime.dbPath)], ["Data dir", basename(runtime.dataDir)], ["Providers recorded", data ? num((data.health || []).length) : "—"]] },
  ];
  return <div className="v5-monitoring-widget"><div className="v5-dashboard-inline-actions"><p className="v5-dashboard-description">Updates every 10 seconds</p><div className="v5-monitoring-widget-actions"><Button aria-pressed={auto} variant="ghost" onClick={() => setAuto((value) => !value)}><MotionIcon name="monitoring" />{auto ? "Live" : "Paused"}</Button><Button variant="secondary" loading={loading} onClick={load}><MotionIcon name="refresh" />Refresh monitoring</Button></div></div>{error ? <div role="alert" className="v5-dashboard-error"><p>Failed to load monitoring status: {error}{data ? ". Last received measurements remain visible." : ". Refresh to try again."}</p></div> : null}{loading && !data ? <div className="v5-dashboard-skeleton" role="status">Loading monitoring status</div> : <div className="v5-monitoring-measurements">{groups.map((group) => <section key={group.title}><h3><MotionIcon name={group.icon} />{group.title}</h3><p className="v5-monitoring-value">{group.value}</p><dl>{group.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>)}</div>}</div>;
}
