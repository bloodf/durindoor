"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import { cn } from "@/shared/utils/cn";

const POLL_MS = 10000;

/**
 * MonitoringStrip — a compact activity summary for the API-keys page.
 *
 * Shows three things:
 *  1. Active requests (summary tiles)
 *  2. Provider health (table)
 *  3. Recent requests (log)
 *
 * Same data as the Monitoring page (/api/monitoring), presented more
 * compactly here so status is visible without switching pages.
 */
export default function MonitoringStrip() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitoring", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setErr("");
    } catch (e) {
      setErr(e?.message || "Failed to load activity");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const rt = data?.runtime || {};
  const health = data?.health || [];
  const recent = data?.activity?.recent || [];

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-500">
          <span className="material-symbols-outlined text-[16px]">warning</span>
          <span>{err}</span>
        </div>
      )}

      {/* 1. Active requests */}
      <Card padding="none">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <span className="material-symbols-outlined text-[18px] text-text-muted">
            pending_actions
          </span>
          <h2 className="text-sm font-semibold text-text-main">Active Requests</h2>
          <span className="text-xs text-text-muted">now</span>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            <Metric
              label="Active"
              value={formatNum(rt.activeRequests)}
              tone={rt.activeRequests > 0 ? "warn" : "neutral"}
            />
            <Metric
              label="Memory"
              value={rt.memoryRssMB ? `${rt.memoryRssMB} MB` : "-"}
            />
            <Metric label="Uptime" value={formatUptime(rt.processUptimeSec)} />
          </div>
        </div>
      </Card>

      {/* 2. Provider health */}
      <Card padding="none">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <span className="material-symbols-outlined text-[18px] text-text-muted">
            health_and_safety
          </span>
          <h2 className="text-sm font-semibold text-text-main">Provider Health</h2>
          <span className="text-xs text-text-muted">last 7 days</span>
        </div>

        {health.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-text-muted">
            No provider activity recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2 font-semibold">Provider</th>
                  <th className="px-4 py-2 text-right font-semibold">Requests</th>
                  <th className="px-4 py-2 text-right font-semibold">Errors</th>
                  <th className="px-4 py-2 text-right font-semibold">Success</th>
                  <th className="px-4 py-2 text-right font-semibold">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {health.slice(0, 10).map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border-subtle/50 last:border-0 hover:bg-surface-2/50"
                  >
                    <td className="px-4 py-2 font-medium text-text-main" title={p.id}>
                      {p.name}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-muted">
                      {formatNum(p.requests)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums",
                        p.errors > 0 ? "text-red-500" : "text-text-muted"
                      )}
                    >
                      {formatNum(p.errors)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <SuccessBadge rate={p.successRate} />
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-text-muted">
                      {formatWhen(p.lastUsed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {health.length > 10 && (
              <p className="border-t border-border-subtle/50 px-4 py-2 text-xs text-text-muted">
                +{health.length - 10} more providers, see the Monitoring page
              </p>
            )}
          </div>
        )}
      </Card>

      {/* 3. Recent requests */}
      <Card padding="none">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <span className="material-symbols-outlined text-[18px] text-text-muted">
            receipt_long
          </span>
          <h2 className="text-sm font-semibold text-text-main">Recent Requests</h2>
        </div>

        {recent.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-text-muted">
            No request logs yet.
          </p>
        ) : (
          <ul>
            {recent.slice(0, 8).map((l, i) => (
              <li
                key={i}
                className="flex items-center gap-3 border-b border-border-subtle/50 px-4 py-2 text-sm last:border-0"
              >
                <span
                  className={cn(
                    "material-symbols-outlined shrink-0 text-[16px]",
                    isOk(l.status) ? "text-green-500" : "text-red-500"
                  )}
                >
                  {isOk(l.status) ? "check_circle" : "cancel"}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-main">
                  <span className="text-text-muted">{l.provider}</span>
                  {l.provider && l.model ? " · " : ""}
                  <span className="font-mono text-xs">{l.model}</span>
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {formatWhen(l.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "warn" ? "text-amber-500" : "text-text-main"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SuccessBadge({ rate }) {
  if (rate === null || rate === undefined) {
    return <span className="text-xs text-text-muted">—</span>;
  }
  const good = rate >= 95;
  const mid = rate >= 80;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tabular-nums",
        good && "bg-green-500/10 text-green-500",
        !good && mid && "bg-amber-500/10 text-amber-500",
        !good && !mid && "bg-red-500/10 text-red-500"
      )}
    >
      {rate}%
    </span>
  );
}

function isOk(status) {
  const s = String(status || "").toLowerCase();
  return s === "ok" || s === "success" || s === "200" || s === "";
}

function formatNum(n) {
  if (n === null || n === undefined) return "0";
  return Number(n).toLocaleString("en-US");
}

function formatUptime(sec) {
  if (!sec || sec < 0) return "-";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatWhen(ts) {
  if (!ts) return "—";

  // 9Router logs use "dd-mm-yyyy HH:MM:SS" (not ISO).
  const m = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(ts).trim());
  let d;
  if (m) {
    d = new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );
  } else {
    d = new Date(ts);
  }

  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16);

  try {
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return d.toLocaleDateString();
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}
