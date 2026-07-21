"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, Button, Input, Toggle } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import { usePagination } from "@/shared/hooks/usePagination";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const WINDOW_TABS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7d", label: "7 days" },
  { id: "last30d", label: "30 days" },
  { id: "all", label: "All time" },
];

const REASON_LABELS = {
  disabled: "Disabled",
  missing_proxy_URL: "Missing proxy URL",
  missing_request_body: "Missing request body",
  "skipped:_openai-responses_tool/reasoning_input_is_not_safe_to_compress": "Unsafe responses input",
  unsupported_: "Unsupported request shape",
  "request_failed:_": "Request failed",
  "proxy_returned_HTTP_": "Proxy error",
  "proxy_response_missing_": "Proxy response missing",
  "proxy_response_did_not_": "Proxy response invalid",
  "proxy_response_has_": "Proxy response invalid",
  unexpected_error: "Unexpected error",
  skipped: "Skipped",
};

const ERROR_REASON_PREFIXES = [
  "request_failed:_", "transform_error", "timeout", "unexpected_error",
  "proxy_returned_HTTP_", "proxy_response_missing_", "proxy_response_did_not_", "proxy_response_has_",
];

function reasonLabel(reason) {
  if (!reason) return "Skipped";
  for (const prefix of Object.keys(REASON_LABELS)) {
    if (reason.startsWith(prefix)) return REASON_LABELS[prefix];
  }
  return reason.length > 40 ? `${reason.slice(0, 40)}…` : reason;
}

function isErrorReason(reason) {
  if (!reason) return false;
  return ERROR_REASON_PREFIXES.some((p) => reason.startsWith(p));
}

function SummaryCard({ label, value, sub, tone }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${tone || ""}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </Card>
  );
}

export default function HeadroomClient() {
  const [settings, setSettings] = useState({
    headroomEnabled: false,
    headroomUrl: "http://localhost:8787",
    headroomCompressUserMessages: false,
  });
  const persistedSettings = useRef(settings);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState({ installed: false, running: false, loading: true });
  const [windowId, setWindowId] = useState("last7d");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refreshStats = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, statsRes] = await Promise.all([
        fetch("/api/headroom/status", { headers: { "Cache-Control": "no-store" } }),
        fetch("/api/headroom/stats"),
      ]);
      setStatus(await statusRes.json());
      setStats(await statsRes.json());
    } catch {
      /* sections render placeholders */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [settingsRes, statusRes, statsRes] = await Promise.all([
          fetch("/api/settings", { headers: { "Cache-Control": "no-store" } }),
          fetch("/api/headroom/status", { headers: { "Cache-Control": "no-store" } }),
          fetch("/api/headroom/stats"),
        ]);
        const [settingsData, statusData, statsData] = await Promise.all([
          settingsRes.json(),
          statusRes.json(),
          statsRes.json(),
        ]);
        if (cancelled) return;
        const next = {
          headroomEnabled: !!settingsData.headroomEnabled,
          headroomUrl: settingsData.headroomUrl || "http://localhost:8787",
          headroomCompressUserMessages: !!settingsData.headroomCompressUserMessages,
        };
        setSettings(next);
        persistedSettings.current = next;
        setStatus(statusData);
        setStats(statsData);
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const patch = async (patch) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("settings update failed");
      persistedSettings.current = { ...persistedSettings.current, ...patch };
      return true;
    } catch (error) {
      console.log("Error updating headroom settings:", error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (value) => {
    setSettings((s) => ({ ...s, headroomEnabled: value }));
    const ok = await patch({ headroomEnabled: value });
    if (!ok) setSettings((s) => ({ ...s, headroomEnabled: persistedSettings.current.headroomEnabled }));
    else refreshStats();
  };

  const handleUrlBlur = async () => {
    const next = settings.headroomUrl.trim() || "http://localhost:8787";
    setSettings((s) => ({ ...s, headroomUrl: next }));
    const ok = await patch({ headroomUrl: next });
    if (!ok) setSettings((s) => ({ ...s, headroomUrl: persistedSettings.current.headroomUrl }));
  };

  const handleToggleCompressUserMessages = async (value) => {
    setSettings((s) => ({ ...s, headroomCompressUserMessages: value }));
    const ok = await patch({ headroomCompressUserMessages: value });
    if (!ok) setSettings((s) => ({ ...s, headroomCompressUserMessages: persistedSettings.current.headroomCompressUserMessages }));
  };

  const w = stats?.windows?.[windowId];
  const statusLabel = !status
    ? "—"
    : status.loading
      ? "Loading…"
      : status.running
        ? "Running"
        : status.installed
          ? "Stopped"
          : "Not installed";

  const {
    pageItems: recentPageItems,
    page: recentPage,
    pageSize: recentPageSize,
    setPage: setRecentPage,
    setPageSize: setRecentPageSize,
    totalItems: recentTotalItems,
    totalPages: recentTotalPages,
  } = usePagination({ items: stats?.recent || [], pageSize: 20, resetKey: windowId });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">compress</span>
          Headroom Dashboard
        </h2>
        <div className="flex items-center gap-2">
          <a href="/dashboard/token-saver" className="text-xs text-primary underline hover:opacity-80">
            Token Saver settings
          </a>
          <Button size="sm" variant="ghost" onClick={refreshStats} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Headroom</p>
            <p className="text-xs text-text-muted">
              {status?.running
                ? "Compress outgoing chat messages via the Headroom proxy."
                : "Headroom proxy is unavailable; confirm the proxy URL before enabling."}
            </p>
          </div>
          <Toggle
            checked={settings.headroomEnabled}
            onChange={handleToggleEnabled}
            disabled={saving || !status?.running}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-text-muted uppercase tracking-wide">Proxy URL</label>
          <Input
            value={settings.headroomUrl}
            onChange={(e) => {
              setSettings((s) => ({ ...s, headroomUrl: e.target.value }));
            }}
            onBlur={handleUrlBlur}
            placeholder="http://localhost:8787"
            disabled={saving}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Compress user messages</p>
            <p className="text-xs text-text-muted">Also compress user turns, not just system/tool context.</p>
          </div>
          <Toggle
            checked={settings.headroomCompressUserMessages}
            onChange={handleToggleCompressUserMessages}
            disabled={saving}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Status" value={statusLabel} />
        <SummaryCard
          label="Total requests"
          value={fmtTokens(w?.requests)}
          sub={windowId === "all" ? undefined : `All time: ${fmtTokens(stats?.windows?.all?.requests)}`}
        />
        <SummaryCard label="Compressed" value={fmtTokens(w?.compressed)} sub={`${fmtTokens(w?.bypassed)} bypassed`} />
        <SummaryCard
          label="Tokens saved"
          value={fmtTokens(w?.tokensSaved)}
          sub={w?.tokensBefore > 0 ? `${w?.savedPct}% of ${fmtTokens(w?.tokensBefore)}` : "No data"}
        />
        <SummaryCard label="Errors" value={fmtTokens(w?.errors)} sub="Failures/timeouts" />
        <SummaryCard
          label="Avg latency"
          value={w?.avgCompressionMs ? `${w.avgCompressionMs}ms` : "—"}
          sub="Per compression request"
        />
      </div>

      <p className="text-xs text-text-muted">
        Saved tokens are as reported by the Headroom proxy; provider billing may differ.
      </p>

      <div className="flex gap-2 flex-wrap">
        {WINDOW_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setWindowId(t.id)}
            className={`px-3 py-1 rounded-full text-sm border transition ${
              windowId === t.id
                ? "bg-primary text-white border-primary"
                : "bg-surface border-border text-text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">Tokens saved per day</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats?.timeline || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={fmtTokens} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--color-bg, #0f172a)", border: "1px solid var(--color-border, #1e293b)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "var(--color-text-muted, #94a3b8)" }}
                itemStyle={{ color: "var(--color-text, #e2e8f0)" }}
                formatter={(value) => [fmtTokens(value || 0), "Tokens saved"]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Area
                type="monotone"
                dataKey="tokensSaved"
                stroke="var(--color-primary)"
                fill="var(--color-primary)"
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">Recent events</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="pb-2">Time</th>
                <th className="pb-2">Provider / Model</th>
                <th className="pb-2">Result</th>
                <th className="pb-2 text-right">Tokens before</th>
                <th className="pb-2 text-right">Tokens saved</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.recent || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-text-muted">
                    No events recorded yet.
                  </td>
                </tr>
              ) : (
                recentPageItems.map((ev, i) => (
                  <tr key={`${ev.ts}-${(recentPage - 1) * recentPageSize + i}`} className="border-b border-border last:border-0">
                    <td className="py-2 whitespace-nowrap">{new Date(ev.ts).toLocaleString()}</td>
                    <td className="py-2">{ev.provider ? `${ev.provider} / ${ev.model}` : "—"}</td>
                    <td className="py-2">
                      {ev.applied ? (
                        <span className="text-success">Compressed</span>
                      ) : (
                        <span className={isErrorReason(ev.reason) ? "text-danger" : "text-text-muted"}>
                          {reasonLabel(ev.reason)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">{fmtTokens(ev.tokensBefore)}</td>
                    <td className="py-2 text-right">{fmtTokens(ev.tokensSaved)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {recentTotalPages > 1 && (
          <Pagination
            currentPage={recentPage}
            pageSize={recentPageSize}
            totalItems={recentTotalItems}
            onPageChange={setRecentPage}
            onPageSizeChange={setRecentPageSize}
          />
        )}
      </Card>
    </div>
  );
}
