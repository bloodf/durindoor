"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { startConsoleLogTransport } from "./transport";
import { CONSOLE_LEVELS } from "./parseConsoleLine";
import {
  EMPTY_CONSOLE_LOG,
  appendConsoleLines,
  clearConsoleEntries,
  countConsoleEntriesSince,
  reconcileConsoleSnapshot,
} from "./consoleLogEntries";
import { buildConsoleLayout, consoleWindow } from "./consoleLogWindow";

/* Windowing contract: unwrapped rows are exactly ROW_HEIGHT px (Tailwind h-6). */
const ROW_HEIGHT = 24;
const OVERSCAN_ROWS = 20;
const DEFAULT_VIEWPORT_HEIGHT = 640;
const ALL_TAGS = "*";

const LEVEL_LABELS = { all: "All", error: "Error", warn: "Warn", info: "Info", debug: "Debug" };

const LEVEL_TEXT = {
  error: "text-dd-danger",
  warn: "text-dd-warning",
  info: "text-dd-info",
  debug: "text-dd-accent-2",
};

const LEVEL_CHIP_ACTIVE = {
  all: "border-dd-accent bg-dd-accent-soft text-dd-accent",
  error: "border-dd-danger bg-dd-danger/10 text-dd-danger",
  warn: "border-dd-warning bg-dd-warning/10 text-dd-warning",
  info: "border-dd-info bg-dd-info/10 text-dd-info",
  debug: "border-dd-accent-2 bg-dd-accent-2-soft text-dd-accent-2",
};

function matchesFilters(entry, tag, needle) {
  if (tag !== ALL_TAGS && entry.tag !== tag) return false;
  return !needle || entry.raw.toLowerCase().includes(needle);
}

function downloadLog(text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `durindoor-console-${stamp}.log`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function HighlightedText({ text, needle }) {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className="rounded-sm bg-dd-warning/25 text-dd-text">{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

function LevelChips({ value, counts, onChange }) {
  return (
    <div role="group" aria-label="Filter by log level" className="flex flex-wrap items-center gap-1.5">
      {["all", ...CONSOLE_LEVELS].map((level) => {
        const active = level === value;
        return (
          <button
            key={level}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(level)}
            className={[
              "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border px-2.5 font-mono text-xs outline-none transition-colors focus-visible:shadow-dd-focus",
              active ? LEVEL_CHIP_ACTIVE[level] : "border-dd-border-subtle bg-dd-surface-2 text-dd-muted hover:border-dd-border hover:text-dd-text",
            ].join(" ")}
          >
            <span>{LEVEL_LABELS[level]}</span>
            <span className="dd-tnum">{counts[level]}</span>
          </button>
        );
      })}
    </div>
  );
}

function LogRow({ entry, index, needle, wrap, top, onMeasure }) {
  const rowRef = useRef(null);
  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!wrap || !element) return undefined;
    const measure = () => onMeasure(entry.id, element.getBoundingClientRect().height);
    measure();
    const observer = globalThis.ResizeObserver ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [entry.id, wrap, onMeasure]);
  const [firstLine, ...moreLines] = entry.message.split("\n");
  return (
    <div
      data-console-row={entry.id}
      ref={rowRef}
      style={{ top }}
      className={[
        "absolute inset-x-0 flex gap-3 px-3 font-mono text-xs leading-6",
        wrap ? "min-h-6" : "h-6 overflow-hidden",
        index % 2 === 1 ? "bg-dd-surface-2" : "",
      ].join(" ")}
      title={wrap ? undefined : entry.raw}
    >
      <span className="w-20 shrink-0 text-dd-subtle dd-tnum"><HighlightedText text={entry.ts ? `[${entry.ts}]` : ""} needle={needle} /></span>
      <span className={`w-11 shrink-0 font-semibold uppercase ${LEVEL_TEXT[entry.level]}`}>{entry.level}</span>
      {wrap ? (
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-dd-text">
          <HighlightedText text={entry.message} needle={needle} />
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate whitespace-pre text-dd-text">
            <HighlightedText text={firstLine} needle={needle} />
          </span>
          {moreLines.length > 0 ? <span className="shrink-0 text-dd-subtle">+{moreLines.length} lines</span> : null}
        </>
      )}
    </div>
  );
}

/**
 * Live console log viewer over the server ring (`CONSOLE_LOG_CONFIG.maxLines`).
 * Lines are parsed by `parseConsoleLine` and filtered by level, tag and search.
 * Pausing freezes the rendered list while the stream keeps filling the ring;
 * the "N new" pill counts all arrivals since pause, including evicted entries.
 * Both row modes are windowed (viewport ±20); wrapped heights are estimated
 * until measured, then positioned using measured cumulative offsets.
 */
export default function ConsoleLogClient() {
  const [log, setLog] = useState(EMPTY_CONSOLE_LOG);
  const [frozen, setFrozen] = useState(null);
  const [level, setLevel] = useState("all");
  const [tag, setTag] = useState(ALL_TAGS);
  const [search, setSearch] = useState("");
  const [wrap, setWrap] = useState(false);
  const [following, setFollowing] = useState(true);
  const [viewport, setViewport] = useState({ top: 0, height: DEFAULT_VIEWPORT_HEIGHT });
  const [measurements, setMeasurements] = useState({ width: 0, heights: new Map() });
  const logRef = useRef(EMPTY_CONSOLE_LOG);
  const viewportRef = useRef(null);
  const transportRef = useRef(null);
  const { copied, copy } = useCopyToClipboard();

  const paused = frozen !== null;
  const shown = frozen ?? log;
  const newCount = paused ? countConsoleEntriesSince(log, frozen.nextId) : 0;
  const needle = search.trim().toLowerCase();

  const applyLog = useCallback((change) => {
    logRef.current = change(logRef.current);
    setLog(logRef.current);
  }, []);
  const clearLog = useCallback(() => {
    applyLog(clearConsoleEntries);
    const nextId = logRef.current.nextId;
    setFrozen((prev) => prev ? { entries: [], nextId } : prev);
  }, [applyLog]);

  useEffect(() => {
    transportRef.current = startConsoleLogTransport({
      onEvent: (msg) => {
        if (msg.type === "init") applyLog((prev) => reconcileConsoleSnapshot(prev, msg.logs));
        else if (msg.type === "line") applyLog((prev) => appendConsoleLines(prev, [msg.line]));
        else if (msg.type === "lines") applyLog((prev) => appendConsoleLines(prev, msg.lines));
        else if (msg.type === "clear") clearLog();
      },
      onSnapshot: (lines) => applyLog((prev) => reconcileConsoleSnapshot(prev, lines)),
    });

    return () => {
      transportRef.current?.stop();
      transportRef.current = null;
    };
  }, [applyLog, clearLog]);

  useEffect(() => {
    const element = viewportRef.current;
    const Observer = globalThis.ResizeObserver;
    if (!element || !Observer) return undefined;
    const observer = new Observer(() => {
      const height = element.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
      setViewport((prev) => (prev.height === height ? prev : { ...prev, height }));
      setMeasurements((prev) => prev.width === element.clientWidth ? prev : { width: element.clientWidth, heights: new Map() });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { filtered, counts, tags } = useMemo(() => {
    const nextCounts = { all: 0, error: 0, warn: 0, info: 0, debug: 0 };
    const seenTags = new Set();
    const rows = [];
    for (const entry of shown.entries) {
      if (entry.tag) seenTags.add(entry.tag);
      if (!matchesFilters(entry, tag, needle)) continue;
      nextCounts.all += 1;
      nextCounts[entry.level] += 1;
      if (level === "all" || entry.level === level) rows.push(entry);
    }
    if (tag !== ALL_TAGS) seenTags.add(tag);
    return { filtered: rows, counts: nextCounts, tags: [...seenTags].sort() };
  }, [shown, level, tag, needle]);

  const layout = useMemo(() => buildConsoleLayout(filtered, wrap, measurements.width, measurements.heights), [filtered, wrap, measurements]);
  const measureRow = useMemo(() => (id, height) => {
    if (height < ROW_HEIGHT) return;
    setMeasurements((prev) => {
      if (prev.heights.get(id) === height) return prev;
      const heights = new Map(prev.heights);
      heights.set(id, height);
      if (heights.size > CONSOLE_LOG_CONFIG.maxLines * 2) heights.delete(heights.keys().next().value);
      return { ...prev, heights };
    });
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || paused || !following) return;
    element.scrollTop = element.scrollHeight;
  }, [filtered, paused, following, wrap, layout]);

  const handleScroll = (event) => {
    const element = event.currentTarget;
    const height = element.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
    setViewport({ top: element.scrollTop, height });
    setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight <= ROW_HEIGHT);
  };

  const handleClear = async () => {
    try {
      const response = await fetch("/api/translator/console-logs", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      transportRef.current?.invalidate();
      clearLog();
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const jumpToLatest = () => {
    setFrozen(null);
    setFollowing(true);
  };

  const visibleText = () => filtered.map((entry) => entry.raw).join("\n");
  const total = filtered.length;
  const tailing = !paused && following;
  const scrollTop = tailing ? Math.max(0, layout.height - viewport.height) : Math.min(viewport.top, Math.max(0, layout.height - viewport.height));
  const { start, end } = consoleWindow(layout.offsets, scrollTop, viewport.height, OVERSCAN_ROWS);
  const rows = filtered.slice(start, end);
  const tagOptions = [{ value: ALL_TAGS, label: "All tags" }, ...tags.map((value) => ({ value, label: value }))];

  return (
    <div className="space-y-4">
      <PageHeader icon="terminal" title="Console Log" subtitle="Live server output" />
      <Card padding={false}>
        <div className="sticky top-0 z-10 space-y-2 rounded-t-dd-lg border-b border-dd-border-subtle bg-dd-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input size="sm" icon="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs" aria-label="Search console logs" className="min-w-[13rem] flex-1 font-mono" />
            <Select size="sm" fullWidth={false} className="w-44" value={tag} onChange={setTag} options={tagOptions} aria-label="Filter by tag" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <StatusDot tone={paused ? "neutral" : "success"} pulse={!paused} label={paused ? "Paused" : "Streaming"} />
              {paused && newCount > 0 ? (
                <span role="status" className="dd-tnum inline-flex h-7 items-center rounded-full border border-dd-info bg-dd-info/10 px-2.5 font-mono text-xs text-dd-info">{newCount} new</span>
              ) : null}
              <Button size="sm" variant="ghost" icon={paused ? "play_arrow" : "pause"} aria-pressed={paused} onClick={() => (paused ? setFrozen(null) : setFrozen(log))}>{paused ? "Resume" : "Pause"}</Button>
              {paused || !following ? <Button size="sm" variant="ghost" icon="vertical_align_bottom" onClick={jumpToLatest}>Jump to latest</Button> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LevelChips value={level} counts={counts} onChange={setLevel} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon="wrap_text" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>Wrap lines</Button>
              <Button size="sm" variant="ghost" icon={copied === "visible" ? "check" : "content_copy"} disabled={total === 0} onClick={() => copy(visibleText(), "visible")}>{copied === "visible" ? "Copied" : "Copy visible"}</Button>
              <Button size="sm" variant="ghost" icon="download" disabled={total === 0} onClick={() => downloadLog(`${visibleText()}\n`)}>Download .log</Button>
              <Button size="sm" variant="ghost" icon="delete_sweep" onClick={handleClear}>Clear</Button>
              <span role="status" className="dd-tnum inline-flex h-7 items-center rounded-dd border border-dd-border-subtle bg-dd-surface-2 px-2 font-mono text-xs text-dd-muted" aria-label={`${total} of ${shown.entries.length} log lines`} title={`Buffer keeps the latest ${CONSOLE_LOG_CONFIG.maxLines} lines`}>{total}/{shown.entries.length}</span>
            </div>
          </div>
        </div>
        <div ref={viewportRef} role="log" tabIndex={0} aria-label="Console log output" aria-live="off" onScroll={handleScroll} className="h-[calc(100vh-320px)] min-h-80 overflow-auto bg-dd-surface">
          {total === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-dd-muted">{shown.entries.length === 0 ? "No console logs yet." : "No matching console logs."}</div>
          ) : (
            <div className="relative" style={{ height: layout.height }}>
              {rows.map((entry, offset) => <LogRow key={entry.id} entry={entry} index={start + offset} needle={needle} wrap={wrap} top={layout.offsets[start + offset]} onMeasure={measureRow} />)}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
