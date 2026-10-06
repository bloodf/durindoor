"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { isNumber } from "@/shared/utils/typeChecks.js";
import { statusTone } from "../timelineStatus.js";

/**
 * Swimlane overview of timeline traces: one horizontal lane per distinct
 * `laneBy` value, one bar per trace positioned by `started_at` and sized by
 * `total_ms` on a shared time axis. Pure SVG; the SVG is drawn at the
 * measured container width so text and bars are never stretched.
 *
 * Lanes are sorted by label. When there are more than MAX_LANES distinct
 * values, the busiest MAX_LANES - 1 keep their own lane and the rest share a
 * trailing "other" lane, so the chart never exceeds MAX_LANES rows.
 */

export const MAX_LANES = 12;
export const OTHER_LANE = "__other__";
export const UNSET_LANE = "__unset__";
export const MIN_BAR_WIDTH = 2;
export const LABEL_WIDTH = 160;
export const DEFAULT_CHART_WIDTH = 960;
const AXIS_HEIGHT = 28;
const LANE_HEIGHT = 44;
const BAR_HEIGHT = 20;
const TICK_STEPS_MS = [5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1_800e3, 3_600e3, 7_200e3, 10_800e3, 21_600e3];

const TONE_FILL = {
  success: "fill-dd-success",
  warning: "fill-dd-warning",
  danger: "fill-dd-danger",
  info: "fill-dd-info",
  neutral: "fill-dd-muted",
};

export function toEpochMs(value) {
  if (isNumber(value)) return Number.isFinite(value) ? value : null;
  if (value == null || value === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function laneKeyOf(trace, laneBy) {
  const value = trace?.[laneBy];
  return value == null || value === "" ? UNSET_LANE : String(value);
}

function compareLaneKeys(a, b) {
  if (a === b) return 0;
  if (a === OTHER_LANE || b === UNSET_LANE) return 1;
  if (b === OTHER_LANE || a === UNSET_LANE) return -1;
  return a.localeCompare(b);
}

/**
 * Group traces into lanes.
 * @returns {{ lanes: string[], laneFor: (trace: any) => string }}
 */
export function buildLanes(traces, laneBy, maxLanes = MAX_LANES) {
  const counts = new Map();
  for (const trace of traces || []) {
    const key = laneKeyOf(trace, laneBy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...counts.keys()];
  if (keys.length <= maxLanes) {
    return { lanes: keys.sort(compareLaneKeys), laneFor: (trace) => laneKeyOf(trace, laneBy) };
  }
  const kept = new Set(
    [...keys]
      .sort((a, b) => counts.get(b) - counts.get(a) || compareLaneKeys(a, b))
      .slice(0, Math.max(0, maxLanes - 1)),
  );
  return {
    lanes: [...[...kept].sort(compareLaneKeys), OTHER_LANE],
    laneFor: (trace) => {
      const key = laneKeyOf(trace, laneBy);
      return kept.has(key) ? key : OTHER_LANE;
    },
  };
}

/**
 * Horizontal placement of one trace inside the plot area (pixels from the
 * plot's left edge). Traces without `total_ms` are still running and extend
 * to `nowMs`. Returns null when the trace lies entirely outside the window.
 */
export function barGeometry(trace, windowStart, windowEnd, plotWidth, nowMs) {
  const start = toEpochMs(trace?.started_at);
  const from = toEpochMs(windowStart);
  const to = toEpochMs(windowEnd);
  if (start == null || from == null || to == null || to <= from || !(plotWidth > 0)) return null;
  const totalMs = trace.total_ms == null ? null : Number(trace.total_ms);
  const duration = Number.isFinite(totalMs)
    ? Math.max(0, totalMs)
    : Math.max(0, (toEpochMs(nowMs) ?? to) - start);
  const end = start + duration;
  if (end < from || start > to) return null;
  const pxPerMs = plotWidth / (to - from);
  const x = Math.max(0, (start - from) * pxPerMs);
  const xEnd = Math.min(plotWidth, (end - from) * pxPerMs);
  return { x, width: Math.max(MIN_BAR_WIDTH, xEnd - x) };
}

export function buildTicks(windowStart, windowEnd, maxTicks = 6) {
  const from = toEpochMs(windowStart);
  const to = toEpochMs(windowEnd);
  if (from == null || to == null || to <= from) return { step: 0, ticks: [] };
  const span = to - from;
  const step = TICK_STEPS_MS.find((candidate) => span / candidate <= maxTicks) ?? TICK_STEPS_MS.at(-1);
  const ticks = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return { step, ticks };
}

function tickLabel(ms, withSeconds) {
  const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  if (withSeconds) options.second = "2-digit";
  return new Date(ms).toLocaleTimeString([], options);
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function traceTooltip(trace) {
  const model = trace.model || "unknown model";
  const status = trace.status || "running";
  const total = trace.total_ms == null ? "—" : trace.total_ms;
  return `${model} · ${status} · ${total} ms · ${trace.event_count ?? 0} events`;
}

function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.floor(node.getBoundingClientRect().width));
    measure();
    if (!globalThis.ResizeObserver) return undefined;
    const observer = new globalThis.ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * @param {object} props
 * @param {Array<object>} props.traces Rows from GET /api/timeline.
 * @param {number|string} props.windowStart Window start (epoch ms or ISO).
 * @param {number|string} props.windowEnd Window end (epoch ms or ISO).
 * @param {"provider"|"connection_id"} props.laneBy Trace field that picks the lane.
 * @param {(traceId: string) => void} props.onSelect Called on bar click, Enter, or Space.
 * @param {number} [props.nowMs] Current time; running traces extend to it.
 * @param {(laneKey: string) => string} [props.formatLane] Display label for a lane value.
 * @param {{ title: React.ReactNode, message?: React.ReactNode }} [props.emptyState]
 */
export default function TimelineSwimlane({ traces, windowStart, windowEnd, laneBy = "provider", onSelect, nowMs, formatLane, emptyState }) {
  const [containerRef, measuredWidth] = useMeasuredWidth();
  const width = measuredWidth > LABEL_WIDTH * 2 ? measuredWidth : DEFAULT_CHART_WIDTH;
  const plotWidth = width - LABEL_WIDTH;

  const placed = useMemo(() => {
    const result = [];
    for (const trace of traces || []) {
      const geometry = barGeometry(trace, windowStart, windowEnd, plotWidth, nowMs);
      if (geometry) result.push({ trace, geometry });
    }
    return result.sort((a, b) => a.geometry.x - b.geometry.x);
  }, [traces, windowStart, windowEnd, plotWidth, nowMs]);

  const { lanes, laneFor } = useMemo(() => buildLanes(placed.map((item) => item.trace), laneBy), [placed, laneBy]);
  const { step, ticks } = useMemo(() => buildTicks(windowStart, windowEnd), [windowStart, windowEnd]);

  const laneLabel = (key) => {
    if (key === OTHER_LANE) return "other";
    if (key === UNSET_LANE) return "unknown";
    return formatLane ? formatLane(key) : key;
  };

  if (placed.length === 0) {
    return (
      <div ref={containerRef} className="w-full">
        <EmptyState icon="timeline" title={emptyState?.title ?? "No traces in this window"} message={emptyState?.message ?? "Bars appear here as requests arrive."} />
      </div>
    );
  }

  const from = toEpochMs(windowStart);
  const to = toEpochMs(windowEnd);
  const xFor = (ms) => LABEL_WIDTH + ((ms - from) / (to - from)) * plotWidth;
  const height = AXIS_HEIGHT + lanes.length * LANE_HEIGHT;
  const now = toEpochMs(nowMs);
  const select = (traceId) => onSelect?.(traceId);

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      <svg
        role="group"
        aria-label={`Trace swimlanes by ${laneBy === "connection_id" ? "connection" : "provider"}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full select-none"
        data-testid="timeline-swimlane"
      >
        <g aria-hidden="true">
          {lanes.map((key, index) => (
            <rect
              key={`stripe-${key}`}
              x={0}
              y={AXIS_HEIGHT + index * LANE_HEIGHT}
              width={width}
              height={LANE_HEIGHT}
              className={index % 2 === 0 ? "fill-dd-surface-2" : "fill-transparent"}
            />
          ))}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={xFor(tick)} x2={xFor(tick)} y1={AXIS_HEIGHT - 6} y2={height} className="stroke-dd-border" strokeWidth={1} />
              <text x={xFor(tick)} y={AXIS_HEIGHT - 10} textAnchor="middle" className="fill-dd-muted text-[11px] dd-tnum">
                {tickLabel(tick, step < 60_000)}
              </text>
            </g>
          ))}
          {lanes.map((key, index) => (
            <text key={`label-${key}`} x={12} y={AXIS_HEIGHT + index * LANE_HEIGHT + LANE_HEIGHT / 2} dominantBaseline="middle" className="fill-dd-text text-xs">
              <title>{laneLabel(key)}</title>
              {truncate(laneLabel(key), 22)}
            </text>
          ))}
          {now != null && now >= from && now <= to ? (
            <line x1={xFor(now)} x2={xFor(now)} y1={AXIS_HEIGHT} y2={height} className="stroke-dd-accent" strokeWidth={1} strokeDasharray="4 3" />
          ) : null}
        </g>
        {placed.map(({ trace, geometry }) => {
          const laneIndex = lanes.indexOf(laneFor(trace));
          const tone = statusTone(trace.status || "running");
          return (
            <rect
              key={trace.id}
              role="button"
              tabIndex={0}
              data-trace-id={trace.id}
              data-lane={lanes[laneIndex]}
              x={LABEL_WIDTH + geometry.x}
              y={AXIS_HEIGHT + laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2}
              width={geometry.width}
              height={BAR_HEIGHT}
              rx={3}
              className={`${TONE_FILL[tone]} cursor-pointer stroke-transparent outline-none [stroke-width:2] hover:opacity-80 focus-visible:stroke-dd-text`}
              onClick={() => select(trace.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                select(trace.id);
              }}
            >
              <title>{traceTooltip(trace)}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
