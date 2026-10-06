"use client";

import { useId, useMemo, useState } from "react";
import EventRow from "./EventRow.jsx";

/**
 * Per-trace waterfall. Each row spans from its first event's `t_ms` to the
 * next row's `t_ms`; the final row ends at `trace.total_ms` (or its own last
 * `t_ms` while the trace is still running). Consecutive `sse_chunk` events
 * collapse into one "N chunks" row. Clicking a row reveals the EventRow
 * detail for every event it covers.
 */

const DIRECTION_FILL = {
  in: "bg-dd-info",
  out: "bg-dd-accent",
  system: "bg-dd-muted",
};
const DIRECTION_LEGEND = [
  { direction: "out", label: "out" },
  { direction: "in", label: "in" },
  { direction: "system", label: "system" },
];

function finiteMs(value) {
  if (value == null || value === "") return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? ms : null;
}

export function buildWaterfallRows(events, totalMs) {
  const ordered = [...(events || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const groups = [];
  for (const event of ordered) {
    const last = groups[groups.length - 1];
    if (event.type === "sse_chunk" && last?.type === "sse_chunk") last.events.push(event);
    else groups.push({ type: event.type, events: [event] });
  }
  return groups.map((group, index) => {
    const first = group.events[0];
    const startMs = finiteMs(first.t_ms) ?? 0;
    const nextFirst = groups[index + 1]?.events[0];
    const endMs = nextFirst
      ? finiteMs(nextFirst.t_ms) ?? startMs
      : finiteMs(totalMs) ?? finiteMs(group.events[group.events.length - 1].t_ms) ?? startMs;
    const chunked = group.type === "sse_chunk" && group.events.length > 1;
    return {
      key: `${first.seq}-${first.type}`,
      type: group.type,
      direction: first.direction || "system",
      label: chunked ? `${group.events.length} chunks` : `#${first.seq} ${first.type}`,
      startMs,
      endMs: Math.max(startMs, endMs),
      events: group.events,
    };
  });
}

export function waterfallSpan(rows, totalMs) {
  return Math.max(1, finiteMs(totalMs) ?? 0, ...rows.map((row) => row.endMs));
}

export default function TraceWaterfall({ trace, events }) {
  const baseId = useId();
  const [open, setOpen] = useState({});
  const rows = useMemo(() => buildWaterfallRows(events, trace?.total_ms), [events, trace?.total_ms]);
  const span = waterfallSpan(rows, trace?.total_ms);

  if (rows.length === 0) return <p className="text-[13px] text-dd-muted">No events recorded for this trace.</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Direction legend" className="flex flex-wrap items-center gap-4 text-xs text-dd-muted">
        {DIRECTION_LEGEND.map(({ direction, label }) => (
          <li key={direction} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${DIRECTION_FILL[direction]}`} />
            {label}
          </li>
        ))}
      </ul>
      <ol aria-label="Trace waterfall" className="flex flex-col">
        {rows.map((row, index) => {
          const expanded = open[row.key] === true;
          const detailId = `${baseId}-row-${index}`;
          const left = (row.startMs / span) * 100;
          const width = ((row.endMs - row.startMs) / span) * 100;
          return (
            <li key={row.key} data-direction={row.direction} className="border-b border-dd-border-subtle last:border-b-0">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={expanded ? detailId : undefined}
                onClick={() => setOpen((previous) => ({ ...previous, [row.key]: !expanded }))}
                className="grid min-h-11 w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-dd px-2 text-left text-xs outline-none hover:bg-dd-surface-2 focus-visible:shadow-dd-focus sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] leading-none text-dd-muted">{expanded ? "expand_more" : "chevron_right"}</span>
                  <span className="truncate font-mono text-dd-text">{row.label}</span>
                  <span className="shrink-0 text-dd-muted">{row.direction}</span>
                </span>
                <span aria-hidden="true" className="relative h-3 rounded-full bg-dd-surface-2">
                  <span
                    data-waterfall-bar=""
                    className={`absolute inset-y-0 rounded-full ${DIRECTION_FILL[row.direction] ?? DIRECTION_FILL.system}`}
                    style={{ left: `min(${left}%, calc(100% - 2px))`, width: `max(2px, ${width}%)` }}
                  />
                </span>
                <span className="whitespace-nowrap text-right font-mono text-dd-muted dd-tnum">{row.startMs}–{row.endMs} ms</span>
              </button>
              {expanded ? (
                <div id={detailId} className="px-2 pb-2">
                  {row.events.map((event) => <EventRow key={`${event.seq}-${event.type}`} event={event} />)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
