"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { cn } from "@/shared/utils/cn";
import { translate as t } from "@/i18n/runtime";
import { isString } from "@/shared/utils/typeChecks.js";

const REFRESH_MS = 15000;

/** Live runtime and recorded provider health, independent of the usage date filter. */
export default function MonitoringWidgets() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [lastAt, setLastAt] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const load = useCallback(async (signal) => {
    try {
      const res = await fetch("/api/monitoring", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (signal.aborted) return;
      setData(json);
      setError("");
      setLastAt(new Date());
    } catch (e) {
      if (!signal.aborted) setError(e?.message || "Failed to load status");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const tick = async () => {
      if (pending) return;
      pending = true;
      try { await load(controller.signal); }
      finally { pending = false; }
    };
    tick();
    const timer = auto ? setInterval(tick, REFRESH_MS) : null;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [auto, load, refreshNonce]);

  const refresh = () => {
    setLoading(true);
    // The refresh effect owns cancellation on navigation and subsequent refreshes.
    setRefreshNonce((value) => value + 1);
  };

  const rt = data?.runtime || {};
  const act = data?.activity || {};
  const today = act.today || {};
  const health = data?.health || [];

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header + refresh controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-dd-text">
            {t("Monitoring")}
          </h2>
          <p className="text-sm text-dd-muted">
            {t("Runtime status, activity, and per-provider health.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={auto}
            onClick={() => setAuto((v) => !v)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-dd px-3 text-[13px] font-medium transition-colors cursor-pointer",
              auto
                ? "bg-dd-accent/10 text-dd-accent"
                : "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text"
            )}
          >
            <span
              className={cn("size-2 rounded-full", auto ? "bg-dd-success" : "bg-dd-muted")}
            />
            {auto ? t("Live") : t("Paused")}
          </button>
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "material-symbols-outlined text-[16px]",
                  loading && "animate-spin"
                )}
              >
                progress_activity
              </span>
              {t("Refresh")}
            </span>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-dd border border-dd-danger bg-dd-surface-2 px-4 py-3 text-dd-danger">
          <span className="material-symbols-outlined mt-0.5 text-[18px]">
            warning
          </span>
          <div className="text-sm">
            <p className="font-medium">{t("Failed to load monitoring status")}</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* System summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="dns"
          label={t("Gateway")}
          value={error ? t("Error") : data ? t("Online") : t("Loading")}
          tone={error ? "bad" : data ? "good" : "neutral"}
          rows={[
            [t("Latency"), data ? `${data.latencyMs} ms` : "-"],
            [t("Version"), data?.version || "-"],
            [t("Uptime"), formatUptime(rt.processUptimeSec)],
            ["Node", rt.nodeVersion || "-"],
          ]}
        />
        <StatCard
          icon="bar_chart"
          label={t("Activity (24h)")}
          value={formatNum(today.requests)}
          tone="neutral"
          rows={[
            [t("Prompt tokens"), formatNum(today.promptTokens)],
            [t("Completion tokens"), formatNum(today.completionTokens)],
            [t("Active providers"), formatNum(today.providers)],
            [t("Models used"), formatNum(today.models)],
          ]}
        />
        <StatCard
          icon="bolt"
          label={t("Gateway latency")}
          value={data ? `${data.latencyMs} ms` : "-"}
          tone={data && data.latencyMs > 1000 ? "warn" : "neutral"}
          rows={[
            [t("Version"), data?.version || "-"],
            [t("Memory"), rt.memoryRssMB ? `${rt.memoryRssMB} MB` : "-"],
            [t("Last error"), rt.errorProvider || "-"],
            [t("Updated"), lastAt ? lastAt.toLocaleTimeString() : "-"],
          ]}
        />
        <StatCard
          icon="storage"
          label={t("Storage")}
          value={rt.dbSizeLabel || "-"}
          tone="neutral"
          rows={[
            [t("Type"), "SQLite"],
            [t("File"), basename(rt.dbPath) || "-"],
            [t("Data dir"), basename(rt.dataDir) || "-"],
            [t("Providers recorded"), formatNum(health.length)],
          ]}
        />
      </div>
      <Card padding="sm">
        <h3 className="mb-3 font-semibold text-dd-text">{t("Active requests")}</h3>
        {rt.activeDetail?.length ? (
          <ul className="flex flex-col gap-2 text-sm text-dd-text">
            {rt.activeDetail.map((request, index) => (
              <li key={`${request.provider}:${request.model}:${request.account}:${index}`} className="flex flex-wrap justify-between gap-2">
                <span>{request.provider} · {request.model} · {request.account}</span>
                <span className="font-mono">{formatNum(request.count)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-dd-muted">{t("No active requests")}</p>}
      </Card>
      <Card padding="sm">
        <h3 className="mb-3 font-semibold text-dd-text">{t("Provider health (7d)")}</h3>
        {health.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-dd-text">
              <thead className="text-left text-dd-muted"><tr>
                {[t("Provider"), t("Requests"), t("Errors"), t("Success rate"), t("Last used")].map((label) => <th key={label} className="p-2">{label}</th>)}
              </tr></thead>
              <tbody>{health.map((provider) => (
                <tr key={provider.id} className="border-t border-dd-border-subtle">
                  <td className="p-2">{provider.name || provider.id}</td>
                  <td className="p-2 font-mono">{formatNum(provider.requests)}</td>
                  <td className="p-2 font-mono">{formatNum(provider.errors)}</td>
                  <td className="p-2 font-mono">{provider.successRate == null ? "—" : `${provider.successRate}%`}</td>
                  <td className="p-2">{provider.lastUsed ? new Date(provider.lastUsed).toLocaleString() : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-dd-muted">{t("No provider activity")}</p>}
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, rows, tone }) {
  const toneClass =
    {
      good: "text-dd-success",
      bad: "text-dd-danger",
      warn: "text-dd-warning",
      neutral: "text-dd-text",
    }[tone] || "text-dd-text";

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-dd-muted">
            {icon}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-dd-muted">
            {label}
          </span>
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
        <dl className="flex flex-col gap-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 text-xs">
              <dt className="text-dd-muted">{k}</dt>
              <dd className="truncate font-medium text-dd-text">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

StatCard.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  rows: PropTypes.array.isRequired,
  tone: PropTypes.string.isRequired,
};

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

function basename(p) {
  if (!isString(p)) return "";
  return p.split("/").filter(Boolean).pop() || "";
}
