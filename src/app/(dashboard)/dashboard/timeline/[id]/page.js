"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, Button, Card, CardSkeleton } from "@/shared/components";
import { isString } from "@/shared/utils/typeChecks.js";

function groupEvents(events) {
  const groups = [];
  for (const event of events || []) {
    const last = groups[groups.length - 1];
    if (event.type === "sse_chunk" && last?.type === "sse_chunk") {
      last.events.push(event);
    } else {
      groups.push({ type: event.type, events: [event] });
    }
  }
  return groups;
}

export default function TimelineDetailPage() {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/timeline/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (res.status === 404) {
          if (!cancelled) setError("Trace not found");
          return;
        }
        if (!res.ok) throw new Error("Failed to load trace");
        const body = await res.json();
        if (!cancelled) setRow(body);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load trace");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const groups = useMemo(() => groupEvents(row?.events), [row]);

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/timeline" className="text-sm text-primary">Back to Timeline</Link>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }
  if (!row) return <CardSkeleton />;

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/dashboard/timeline" className="text-sm text-primary">Back to Timeline</Link>
        <Button variant="outline" size="sm" onClick={copy}>{copied ? "Copied" : "Copy as JSON"}</Button>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge size="sm">{row.trace.status || "running"}</Badge>
          <span>{row.trace.provider}/{row.trace.model}</span>
          <span className="text-text-muted">{row.trace.started_at}</span>
        </div>
      </Card>
      <Card padding="none">
        <ol className="divide-y divide-border/60">
          {groups.map((group, index) => {
            const chunks = group.type === "sse_chunk" && group.events.length > 1;
            const open = expanded[index] === true;
            return (
              <li key={`${group.type}-${index}`} className="px-3 py-2 text-sm">
                {chunks && !open ? (
                  <button type="button" className="text-left text-primary" onClick={() => setExpanded((prev) => ({ ...prev, [index]: true }))}>
                    {group.events.length} chunks
                  </button>
                ) : (
                  <>
                    {chunks && (
                      <button type="button" className="mb-1 text-left text-primary" onClick={() => setExpanded((prev) => ({ ...prev, [index]: false }))}>
                        Collapse {group.events.length} chunks
                      </button>
                    )}
                    {group.events.map((event) => (
                      <div key={`${event.seq}-${event.type}`} className="py-1">
                        <div className="flex gap-2 text-text-muted">
                          <span className="font-mono text-xs">#{event.seq}</span>
                          <span>{event.type}</span>
                          <span>{event.direction}</span>
                          {event.summary && <span>{event.summary}</span>}
                        </div>
                        {event.payload != null && (
                          <pre className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-xs dark:bg-white/5">
                            {isString(event.payload) ? event.payload : JSON.stringify(event.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
