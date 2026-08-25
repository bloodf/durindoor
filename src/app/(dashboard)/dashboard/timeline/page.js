"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Card, CardSkeleton, Toggle } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";

const FILTER_KEYS = ["provider", "model", "connectionId", "apiKeyId", "status", "endpoint", "startDate", "endDate"];

function statusVariant(status) {
  if (status === "ok") return "success";
  if (status === "aborted") return "warning";
  if (status === "error") return "error";
  return "default";
}

export default function TimelinePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <TimelineList />
    </Suspense>
  );
}

function TimelineList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState({ traces: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } });
  const [captureOn, setCaptureOn] = useState(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    next.set("page", searchParams.get("page") || "1");
    next.set("pageSize", searchParams.get("pageSize") || "20");
    return next;
  }, [searchParams]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [timelineRes, settingsRes] = await Promise.all([
        fetch(`/api/timeline?${query.toString()}`, { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      if (timelineRes.ok) setData(await timelineRes.json());
      else setError("Failed to load timeline");
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setCaptureOn(settings.enableProxyTimeline === true);
      }
    } catch (err) {
      setError(err?.message || "Failed to load timeline");
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!live) return undefined;
    const source = new EventSource(`/api/timeline/stream?${query.toString()}`);
    source.onmessage = () => { load(); };
    return () => source.close();
  }, [live, query, load]);

  const pagination = data.pagination || { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 };
  const setPage = (page) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    router.replace(`/dashboard/timeline?${next.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-text-muted">Redacted sidecar hops. Filter via the URL query string.</p>
        <label className="flex items-center gap-2 text-sm">
          Live
          <Toggle checked={live} onChange={setLive} ariaLabel="Live timeline updates" />
        </label>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Card padding="none">
        {data.traces.length === 0 ? (
          <div className="p-6 text-sm text-text-muted">
            {captureOn === false ? (
              <>Capture is off. Enable it in <Link href="/dashboard/profile" className="text-primary">Settings</Link>.</>
            ) : "waiting for a call"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Connection</th>
                  <th className="px-3 py-2">Events</th>
                  <th className="px-3 py-2">Fallbacks</th>
                  <th className="px-3 py-2">ms</th>
                </tr>
              </thead>
              <tbody>
                {data.traces.map((trace) => (
                  <tr key={trace.id} className="border-t border-border/60">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/dashboard/timeline/${trace.id}`} className="text-primary hover:underline">
                        {trace.started_at}
                      </Link>
                    </td>
                    <td className="px-3 py-2"><Badge variant={statusVariant(trace.status)} size="sm">{trace.status || "running"}</Badge></td>
                    <td className="px-3 py-2">{trace.provider || "—"}</td>
                    <td className="px-3 py-2">{trace.model || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{trace.connection_id || "—"}</td>
                    <td className="px-3 py-2">{trace.event_count ?? 0}</td>
                    <td className="px-3 py-2">{trace.fallback_count ?? 0}</td>
                    <td className="px-3 py-2">{trace.total_ms ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pagination.totalItems > 0 && (
        <Pagination
          currentPage={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
