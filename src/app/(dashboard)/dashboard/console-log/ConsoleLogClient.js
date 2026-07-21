"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, Input } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { startConsoleLogTransport } from "./transport";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

// Detect the log level from the first bracketed token, e.g. "[INFO] ...".
// NOTE: use a non-global regex and read capture group [1]; a /g match returns
// full-match strings (["[INFO]"]) whose [1] is undefined, so every line would
// fall back to the default color.
function getLogLevel(line) {
  const match = line.match(/\[(\w+)\]/);
  return match ? match[1] : null;
}

function colorLine(line) {
  const color = LOG_LEVEL_COLORS[getLogLevel(line)] || "text-green-400";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState("ALL");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const logRef = useRef(null);
  const transportRef = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const handleClear = async () => {
    try {
      const response = await fetch("/api/translator/console-logs", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      transportRef.current?.invalidate();
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    transportRef.current = startConsoleLogTransport({
      onEvent: (msg) => {
        if (pausedRef.current) return;
        if (msg.type === "init") {
          setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else if (msg.type === "line") {
          setLogs((prev) => [...prev, msg.line].slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else if (msg.type === "lines") {
          setLogs((prev) => [...prev, ...msg.lines].slice(-CONSOLE_LOG_CONFIG.maxLines));
        } else if (msg.type === "clear") {
          setLogs([]);
        }
      },
      onSnapshot: (nextLogs) => {
        setLogs(nextLogs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      },
    });

    return () => {
      transportRef.current?.stop();
      transportRef.current = null;
    };
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const visibleLogs = logs.filter((line) =>
    (level === "ALL" || line.includes(`[${level}]`))
    && (!search || line.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-text-muted text-lg">terminal</span>
          <h2 className="text-sm font-semibold">Console Log</h2>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted tabular-nums">
            {visibleLogs.length}/{logs.length}
          </span>
          {paused && (
            <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs font-medium text-yellow-500">Paused</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs"
            aria-label="Search console logs"
            className="max-w-xs"
          />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            aria-label="Filter by log level"
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm"
          >
            {["ALL", ...Object.keys(LOG_LEVEL_COLORS)].map((value) => <option key={value}>{value}</option>)}
          </select>
          <Button
            size="sm"
            variant="outline"
            icon={paused ? "play_arrow" : "pause"}
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>Clear</Button>
        </div>
      </div>
      <div
        ref={logRef}
        role="log"
        aria-live={paused ? "off" : "polite"}
        className="bg-ink p-4 text-xs font-mono leading-relaxed h-[calc(100vh-220px)] overflow-y-auto"
      >
        {visibleLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-text-muted">
            {logs.length === 0 ? "No console logs yet." : "No matching console logs."}
          </div>
        ) : (
          <div className="space-y-0.5">
            {visibleLogs.map((line, i) => (
              <div key={i} className="rounded px-1 hover:bg-white/5">{colorLine(line)}</div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
