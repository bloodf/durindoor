import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import Tabs from "@/shared/ui/components/Tabs.jsx";

import {
  LOG_BUFFER_TOTAL,
  LOG_LEVEL_COUNTS,
  LOG_LINES,
  LOG_STATS,
  LOG_TOP_SOURCES,
  LOG_VOLUME,
} from "./mockData.js";

const VIEW_TABS = [
  { value: "log", label: "Log", icon: "terminal" },
  { value: "timeline", label: "Timeline", icon: "timeline" },
];

const LEVEL_FILTERS = [
  { value: "all", label: "All", count: LOG_BUFFER_TOTAL, active: "border-dd-accent bg-dd-accent-soft text-dd-accent" },
  ...LOG_LEVEL_COUNTS.map((level) => ({
    ...level,
    active: level.value === "info"
      ? "border-dd-info bg-dd-info/10 text-dd-info"
      : level.value === "warn"
        ? "border-dd-warning bg-dd-warning/10 text-dd-warning"
        : "border-dd-danger bg-dd-danger/10 text-dd-danger",
  })),
];

const LEVEL_TEXT = {
  info: "text-dd-info",
  success: "text-dd-success",
  warn: "text-dd-warning",
  error: "text-dd-danger",
};

const LEVEL_ICON = {
  info: "info",
  success: "check_circle",
  warn: "warning",
  error: "cancel",
};

const TAG_TEXT = {
  POST: "text-dd-info",
  DONE: "text-dd-success",
  CANCELLED: "text-dd-danger",
  HEADROOM: "text-dd-warning",
};

const BREAKDOWN_STYLE = {
  info: { text: "text-dd-info", dot: "bg-dd-info", width: "w-[85.5%]" },
  warning: { text: "text-dd-warning", dot: "bg-dd-warning", width: "w-[13%]" },
  danger: { text: "text-dd-danger", dot: "bg-dd-danger", width: "w-[1.5%]" },
};

function LogLine({ line, alternate }) {
  const levelClass = LEVEL_TEXT[line.level] ?? "text-dd-text";

  return (
    <div className={`flex items-start gap-2 px-3 py-1.5 leading-snug ${alternate ? "bg-dd-surface-2/50" : ""}`}>
      <span className="shrink-0 text-dd-subtle dd-tnum">[{line.ts}]</span>
      <span className={`material-symbols-outlined shrink-0 text-[14px] leading-none ${levelClass}`} aria-hidden="true">
        {line.icon ?? LEVEL_ICON[line.level] ?? "info"}
      </span>
      <span className={`w-16 shrink-0 font-semibold uppercase ${levelClass}`}>{line.level}</span>
      <span className={TAG_TEXT[line.tag] ?? "text-dd-muted"}>[{line.tag}]</span>
      <span className="min-w-0 break-words text-dd-text">{line.message}</span>
    </div>
  );
}

function LevelFilters({ value, onChange }) {
  return (
    <div role="group" className="flex flex-wrap items-center gap-1.5" aria-label="Filter by log level">
      {LEVEL_FILTERS.map((filter) => {
        const active = filter.value === value;
        return (
          <button
            key={filter.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter.value)}
            className={[
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-xs outline-none transition-colors focus-visible:shadow-dd-focus",
              active
                ? filter.active
                : "border-dd-border-subtle bg-dd-surface-2 text-dd-muted hover:border-dd-border hover:text-dd-text",
            ].join(" ")}
          >
            <span>{filter.label}</span>
            <span className="dd-tnum opacity-80">{filter.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toolbar({ view, onViewChange, query, onQueryChange, level, onLevelChange, paused, onTogglePause, onClear, count }) {
  return (
    <Card padding={false}>
      <Tabs tabs={VIEW_TABS} value={view} onChange={onViewChange} aria-label="Console view" />
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {view === "log" ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Input
              size="sm"
              icon="search"
              placeholder="Filter log lines…"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              aria-label="Filter log lines"
              className="w-full max-w-sm font-mono"
            />
            <LevelFilters value={level} onChange={onLevelChange} />
          </div>
        ) : (
          <span className="min-w-0 flex-1 text-xs text-dd-muted">Last 60 minutes of console activity</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <StatusDot tone={paused ? "neutral" : "success"} pulse={!paused} label={paused ? "Paused" : "Streaming"} />
          <Button variant="ghost" size="sm" icon={paused ? "play_arrow" : "pause"} onClick={onTogglePause}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" size="sm" icon="delete_sweep" onClick={onClear} disabled={view !== "log"}>
            Clear
          </Button>
          <span
            className="dd-tnum inline-flex h-7 items-center rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 font-mono text-xs text-dd-muted"
            aria-label={`${count} of ${LOG_BUFFER_TOTAL} lines`}
            title={`${count} of ${LOG_BUFFER_TOTAL} lines in the rolling buffer`}
          >
            {count}/{LOG_BUFFER_TOTAL}
          </span>
        </div>
      </div>
    </Card>
  );
}

function LogViewer({ lines }) {
  if (lines.length === 0) {
    return (
      <div role="status" className="flex h-64 items-center justify-center rounded-dd-lg border border-dd-border-subtle bg-dd-surface font-mono text-xs text-dd-muted">
        No log lines match the current filter.
      </div>
    );
  }

  return (
    <div role="log" aria-label="Server console output" className="h-[640px] overflow-y-auto rounded-dd-lg border border-dd-border bg-dd-surface py-2 font-mono text-xs">
      {lines.map((line, index) => (
        <LogLine key={`${line.ts}-${index}`} line={line} alternate={index % 2 === 1} />
      ))}
    </div>
  );
}

function LogVolumeChart() {
  return (
    <Card padding={false} className="min-w-0">
      <CardHeader icon="area_chart" title="Log volume" subtitle="Entries per minute over the last 60 minutes" />
      <CardContent className="h-[300px] pb-3 pl-2 pr-4 pt-5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={LOG_VOLUME} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="consoleVolumeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--dd-info)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--dd-info)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--dd-border-subtle)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="minute"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
              tickMargin={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={32}
              tick={{ fill: "var(--dd-text-subtle)", fontSize: 11 }}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--dd-border)" }}
              contentStyle={{
                background: "var(--dd-surface-3)",
                border: "1px solid var(--dd-border)",
                borderRadius: "var(--dd-radius)",
                color: "var(--dd-text)",
                fontSize: 12,
              }}
              formatter={(value) => [value, "Entries"]}
              labelFormatter={(label) => label === "Now" ? "Now" : `${label.slice(1)} ago`}
            />
            <Area
              type="monotone"
              dataKey="entries"
              stroke="var(--dd-info)"
              strokeWidth={2}
              fill="url(#consoleVolumeFill)"
              activeDot={{ fill: "var(--dd-info)", stroke: "var(--dd-surface)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function LevelBreakdown() {
  return (
    <Card padding={false}>
      <CardHeader icon="stacked_bar_chart" title="By level" subtitle="Current rolling buffer" />
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {LOG_LEVEL_COUNTS.map((level) => {
            const style = BREAKDOWN_STYLE[level.tone];
            return (
              <span key={level.value} className={`inline-flex items-center gap-2 rounded-full border border-dd-border-subtle bg-dd-surface-2 px-3 py-1.5 text-xs font-medium ${style.text}`}>
                <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
                {level.label}
                <span className="dd-tnum font-mono">{level.count}</span>
              </span>
            );
          })}
        </div>
        <div role="img" className="flex h-2 overflow-hidden rounded-full bg-dd-surface-2" aria-label="171 info, 26 warnings, and 3 errors">
          {LOG_LEVEL_COUNTS.map((level) => {
            const style = BREAKDOWN_STYLE[level.tone];
            return <span key={level.value} className={`${style.width} ${style.dot}`} />;
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TopSources() {
  const maxCount = LOG_TOP_SOURCES[0].count;

  return (
    <Card padding={false}>
      <CardHeader icon="dns" title="Top sources" subtitle="Most active console emitters" />
      <CardContent className="space-y-4">
        {LOG_TOP_SOURCES.map((source) => (
          <div key={source.source} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono font-medium text-dd-text">{source.source}</span>
              <span className="dd-tnum font-mono text-dd-muted">{source.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-dd-surface-2">
              <div className="h-full rounded-full bg-dd-info" style={{ width: `${(source.count / maxCount) * 100}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TimelineView() {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Console summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LOG_STATS.map((stat) => <StatCard key={stat.label} {...stat} />)}
      </section>
      <LogVolumeChart />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LevelBreakdown />
        <TopSources />
      </div>
    </div>
  );
}

/** Durin DS Console Log mock with live-log and 60-minute timeline views. */
export default function ConsoleLogPage({
  initialLines = LOG_LINES,
  initialLevel = "all",
  initialQuery = "",
  initialView = "log",
  initialPaused = false,
} = {}) {
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState(initialQuery);
  const [level, setLevel] = useState(initialLevel);
  const [paused, setPaused] = useState(initialPaused);
  const [cleared, setCleared] = useState(false);

  const bufferLines = useMemo(() => initialLines.slice(-LOG_BUFFER_TOTAL), [initialLines]);
  const visibleLines = useMemo(() => {
    if (cleared) return [];
    const needle = query.trim().toLowerCase();
    return bufferLines.filter((line) => {
      const matchesLevel = level === "all" || (level === "info" ? line.level === "info" || line.level === "success" : line.level === level);
      if (!matchesLevel) return false;
      if (!needle) return true;
      return line.message.toLowerCase().includes(needle) || line.tag.toLowerCase().includes(needle) || line.ts.toLowerCase().includes(needle);
    });
  }, [bufferLines, query, level, cleared]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <PageHeader icon="terminal" title="Console Log" subtitle="Live server console output" />
      <Toolbar
        view={view}
        onViewChange={setView}
        query={query}
        onQueryChange={setQuery}
        level={level}
        onLevelChange={setLevel}
        paused={paused}
        onTogglePause={() => setPaused((value) => !value)}
        onClear={() => setCleared(true)}
        count={view === "log" ? visibleLines.length : LOG_BUFFER_TOTAL}
      />
      <div role="tabpanel" aria-label={`${view === "log" ? "Log" : "Timeline"} view`} tabIndex={0}>
        {view === "log" ? <LogViewer lines={visibleLines} /> : <TimelineView />}
      </div>
    </div>
  );
}
