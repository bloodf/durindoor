"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Tabs from "@/shared/ui/components/Tabs.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import { formatCompactToken } from "@/shared/utils/formatCompact";
import { isNumber } from "@/shared/utils/typeChecks";

const ENDED_VISIBILITY_MS = 15000;

/** Ticks once a second so `visibleSessions` re-evaluates the 15s ended-session fade window. */
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function tokens(value, formatToken) {
  const compact = formatToken(value);
  return <span role="img" className="dd-tnum" title={compact.title} aria-label={compact.title}>{compact.display}</span>;
}

export default function RequestsPanel({ recentRequests = [], activeSessions = [], formatToken = formatCompactToken }) {
  const [tab, setTab] = useState("recent");
  const now = useClock();
  const visibleSessions = useMemo(
    () => activeSessions.filter((session) => {
      if (session.status === "active" || !session.completedAt) return true;
      const completedAtMs = isNumber(session.completedAt) ? session.completedAt : new Date(session.completedAt).getTime();
      return !Number.isFinite(completedAtMs) || now - completedAtMs < ENDED_VISIBILITY_MS;
    }),
    [activeSessions, now],
  );
  const columns = tab === "recent"
    ? [
        { key: "status", label: "", render: (request) => <StatusDot tone={!request.status || request.status === "ok" || request.status === "success" ? "success" : "danger"} /> },
        { key: "model", label: "Model", mono: true, rowHeader: true, render: (request) => <span title={request.model}>{request.model}</span> },
        { key: "tokens", label: "In / Out", align: "right", mono: true, render: (request) => <>{tokens(request.promptTokens, formatToken)} / {tokens(request.completionTokens, formatToken)}</> },
        { key: "timestamp", label: "When", align: "right", render: (request) => timeAgo(request.timestamp) },
      ]
    : [
        { key: "status", label: "", render: (session) => <StatusDot tone={session.status === "error" ? "danger" : session.status === "active" ? "success" : "neutral"} pulse={session.status === "active"} /> },
        { key: "clientId", label: "Client", mono: true, rowHeader: true, render: (session) => <span title={session.clientId}>{session.clientId}</span> },
        { key: "model", label: "Model", mono: true, render: (session) => <span title={`${session.model} · ${session.provider}`}>{session.model}</span> },
        { key: "tokens", label: "In / Out", align: "right", mono: true, render: (session) => session.promptTokens != null || session.completionTokens != null ? <>{tokens(session.promptTokens, formatToken)} / {tokens(session.completionTokens, formatToken)}</> : "—" },
      ];
  const rows = tab === "recent" ? recentRequests : visibleSessions;
  return (
    <Card padding={false} className="flex min-w-0 flex-col overflow-hidden" style={{ height: 480 }}>
      <CardHeader icon="monitoring" title="Requests" subtitle={tab === "sessions" ? `${visibleSessions.filter((session) => session.status === "active").length} active` : undefined} />
      <div className="border-b border-dd-border-subtle px-3 py-2">
        <Tabs tabs={[{ value: "recent", label: "Recent requests" }, { value: "sessions", label: "Sessions" }]} value={tab} onChange={setTab} />
      </div>
      <CardContent className="min-h-0 flex-1 overflow-auto p-0">
        <DataTable framed={false} columns={columns} rows={rows} keyFn={(row, index) => row.requestId ?? `${row.timestamp ?? row.clientId}-${index}`} density="compact" caption={tab === "recent" ? "Recent requests" : "Active sessions"} emptyState={{ icon: "inbox", title: tab === "recent" ? "No requests yet" : "No active sessions" }} />
      </CardContent>
    </Card>
  );
}
