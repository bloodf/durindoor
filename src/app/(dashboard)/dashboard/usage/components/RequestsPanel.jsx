"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import { fmt } from "./UsageTable";

const TABS = [
  { value: "recent", label: "Recent Requests" },
  { value: "sessions", label: "Sessions" },
];
const ENDED_VISIBILITY_MS = 15000;

function useClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
}

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Render recent requests and live concurrent sessions in the existing usage card. */
export default function RequestsPanel({ recentRequests = [], activeSessions = [] }) {
  const [tab, setTab] = useState("recent");
  useClock();
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-1 py-2">
        <div className="flex gap-1">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tab === item.value ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-bg-subtle hover:text-text"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "sessions" && <span className="text-[11px] text-text-muted">{activeSessions.filter((session) => session.status === "active").length} active</span>}
      </div>
      {tab === "recent" ? <RecentRequests requests={recentRequests} /> : <Sessions sessions={activeSessions} />}
    </Card>
  );
}

function RecentRequests({ requests }) {
  if (!requests.length) return <div className="flex flex-1 items-center justify-center text-sm text-text-muted">No requests yet.</div>;
  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full min-w-[300px] border-collapse text-xs">
        <thead className="sticky top-0 bg-bg"><tr className="border-b border-border"><th className="w-2 py-1.5" /><th className="py-1.5 text-left text-text-muted">Model</th><th className="py-1.5 text-right text-text-muted">In / Out</th><th className="py-1.5 text-right text-text-muted">When</th></tr></thead>
        <tbody className="divide-y divide-border/50">
          {requests.map((request, index) => {
            const ok = !request.status || request.status === "ok" || request.status === "success";
            return <tr key={`${request.timestamp}-${index}`}><td className="py-1.5"><span className={`block size-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} /></td><td className="max-w-[120px] truncate py-1.5 font-mono" title={request.model}>{request.model}</td><td className="whitespace-nowrap py-1.5 text-right"><span className="text-primary">{fmt(request.promptTokens)}↑</span>{" "}<span className="text-success">{fmt(request.completionTokens)}↓</span></td><td className="whitespace-nowrap py-1.5 text-right text-text-muted">{timeAgo(request.timestamp)}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function Sessions({ sessions }) {
  const now = Date.now();
  const visible = sessions.filter((session) => session.status === "active" || !session.completedAt || now - session.completedAt < ENDED_VISIBILITY_MS);
  if (!visible.length) return <div className="flex flex-1 items-center justify-center text-sm text-text-muted">No active sessions.</div>;
  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full min-w-[320px] border-collapse text-xs">
        <thead className="sticky top-0 bg-bg"><tr className="border-b border-border"><th className="w-2 py-1.5" /><th className="py-1.5 text-left text-text-muted">Client IP</th><th className="py-1.5 text-left text-text-muted">Model</th><th className="py-1.5 text-right text-text-muted">In / Out</th></tr></thead>
        <tbody className="divide-y divide-border/50">
          {visible.map((session) => {
            const dot = session.status === "error" ? "bg-error" : session.status === "active" ? "animate-pulse bg-primary" : "bg-success";
            const hasTokens = session.promptTokens != null || session.completionTokens != null;
            return <tr key={session.requestId}><td className="py-1.5"><span className={`block size-1.5 rounded-full ${dot}`} /></td><td className="max-w-[110px] truncate py-1.5 font-mono" title={session.clientId}>{session.clientId}</td><td className="max-w-[140px] truncate py-1.5 font-mono" title={`${session.model} · ${session.provider}`}>{session.model}</td><td className="whitespace-nowrap py-1.5 text-right">{hasTokens ? <><span className="text-primary">{fmt(session.promptTokens)}↑</span>{" "}<span className="text-success">{fmt(session.completionTokens)}↓</span></> : "—"}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
