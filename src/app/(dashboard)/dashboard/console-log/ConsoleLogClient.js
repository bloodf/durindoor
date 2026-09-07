"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { startConsoleLogTransport } from "./transport";

const LOG_LEVEL_COLORS = {
  LOG: "text-dd-success",
  INFO: "text-dd-info",
  WARN: "text-dd-warning",
  ERROR: "text-dd-danger",
  DEBUG: "text-dd-accent-2",
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
  const color = LOG_LEVEL_COLORS[getLogLevel(line)] || "text-dd-text";
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
    <div className="space-y-4">
      <PageHeader icon="terminal" title="Console Log" subtitle="Live server output" actions={<Badge tone={paused ? "warning" : "success"}>{paused ? "Paused" : "Streaming"}</Badge>} />
      <Card padding={false}>
        <CardContent className="flex flex-wrap items-center gap-2 border-b border-dd-border-subtle">
          <Input size="sm" icon="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs" aria-label="Search console logs" className="min-w-[13rem] flex-1" />
          <Select size="sm" value={level} onChange={setLevel} options={["ALL", ...Object.keys(LOG_LEVEL_COLORS)].map((value) => ({ value, label: value }))} aria-label="Filter by log level" />
          <Button size="sm" variant="ghost" icon={paused ? "play_arrow" : "pause"} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Resume" : "Pause"}</Button>
          <Button size="sm" variant="ghost" icon="delete_sweep" onClick={handleClear}>Clear</Button>
          <span role="status" className="dd-tnum text-xs text-dd-muted" aria-label={`${visibleLogs.length} of ${logs.length} log lines`}>{visibleLogs.length}/{logs.length}</span>
        </CardContent>
        <div ref={logRef} role="log" tabIndex={0} aria-label="Console log output" aria-live={paused ? "off" : "polite"} className="h-[calc(100vh-260px)] min-h-80 overflow-y-auto bg-dd-surface-2 py-2">
          {visibleLogs.length === 0 ? <div className="flex h-full items-center justify-center text-[13px] text-dd-muted">{logs.length === 0 ? "No console logs yet." : "No matching console logs."}</div> : visibleLogs.map((line, index) => <div key={`${index}-${line}`} className="break-words px-3 py-1 font-mono text-xs leading-relaxed hover:bg-dd-surface"><span>{colorLine(line)}</span></div>)}
        </div>
      </Card>
    </div>
  );
}
