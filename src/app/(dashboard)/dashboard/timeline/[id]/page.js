"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import KeyValue from "@/shared/ui/components/KeyValue.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { isString } from "@/shared/utils/typeChecks.js";
import TimelineDetailSkeleton from "./TimelineDetailSkeleton.jsx";

function groupEvents(events) {
  const groups = [];
  for (const event of events || []) {
    const last = groups[groups.length - 1];
    if (event.type === "sse_chunk" && last?.type === "sse_chunk") last.events.push(event);
    else groups.push({ type: event.type, events: [event] });
  }
  return groups;
}
function statusTone(status) {
  if (status === "ok") return "success";
  if (status === "aborted") return "warning";
  if (status === "error") return "danger";
  if (status === "running") return "info";
  return "neutral";
}

function EventRow({ event }) {
  return (
    <div className="py-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-dd-muted">
        <span className="font-mono dd-tnum">#{event.seq}</span>
        <span>{event.type}</span>
        <span>{event.direction}</span>
        {event.summary ? <span className="text-dd-text">{event.summary}</span> : null}
      </div>
      {event.payload != null ? (
        <pre className="mt-1.5 overflow-x-auto rounded-dd border border-dd-border-subtle bg-dd-surface-2 p-2.5 text-xs text-dd-text">
          {isString(event.payload) ? event.payload : JSON.stringify(event.payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function EventGroup({ group, index, open, onToggle }) {
  const chunked = group.type === "sse_chunk" && group.events.length > 1;
  if (chunked && !open) {
    return (
      <li className="px-4 py-2.5 text-[13px]">
        <button
          type="button"
          onClick={() => onToggle(index, true)}
          className="inline-flex min-h-11 items-center rounded-dd px-1 text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus"
        >
          {group.events.length} chunks
        </button>
      </li>
    );
  }
  return (
    <li className="px-4 py-2.5 text-[13px]">
      {chunked ? (
        <button
          type="button"
          onClick={() => onToggle(index, false)}
          className="mb-1 inline-flex min-h-11 items-center rounded-dd px-1 text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus"
        >
          Collapse {group.events.length} chunks
        </button>
      ) : null}
      {group.events.map((event) => <EventRow key={`${event.seq}-${event.type}`} event={event} />)}
    </li>
  );
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Link href="/dashboard/timeline" className="inline-flex w-fit min-h-11 items-center text-[13px] text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus">Back to Timeline</Link>
        <p role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-[13px] text-dd-danger">{error}</p>
      </div>
    );
  }
  if (!row) return <TimelineDetailSkeleton />;

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const trace = row.trace || {};

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        icon="timeline"
        title="Trace detail"
        subtitle={trace.started_at || "Redacted sidecar trace"}
        actions={<Button variant="secondary" icon="content_copy" onClick={copy}>{copied ? "Copied" : "Copy as JSON"}</Button>}
      />
      <Link href="/dashboard/timeline" className="inline-flex w-fit min-h-11 items-center text-[13px] text-dd-accent outline-none hover:underline focus-visible:shadow-dd-focus">Back to Timeline</Link>
      <Card padding={false}>
        <CardHeader icon="info" title="Trace summary" actions={<Badge tone={statusTone(trace.status || "running")} size="sm">{trace.status || "running"}</Badge>} />
        <CardContent>
          <KeyValue items={[
            { label: "Provider", value: trace.provider || "—" },
            { label: "Model", value: trace.model || "—", mono: true },
            { label: "Started", value: trace.started_at || "—", mono: true },
            { label: "Connection", value: trace.connection_id || "—", mono: true },
          ]} />
        </CardContent>
      </Card>
      <Card padding={false}>
        <CardHeader icon="list_alt" title="Events" subtitle={`${groups.length} event group${groups.length === 1 ? "" : "s"}`} />
        {groups.length === 0 ? (
          <CardContent><p className="text-[13px] text-dd-muted">No events recorded for this trace.</p></CardContent>
        ) : (
          <ol className="divide-y divide-dd-border-subtle">
            {groups.map((group, index) => (
              <EventGroup
                key={`${group.type}-${index}`}
                group={group}
                index={index}
                open={expanded[index] === true}
                onToggle={(i, value) => setExpanded((prev) => ({ ...prev, [i]: value }))}
              />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
