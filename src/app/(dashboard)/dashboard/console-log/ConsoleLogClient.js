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

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/\[|\]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";
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
    <div className="">
      <Card>
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-3 pb-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search logs" className="max-w-xs" />
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm">
            {["ALL", ...Object.keys(LOG_LEVEL_COLORS)].map((value) => <option key={value}>{value}</option>)}
          </select>
          <Button size="sm" variant="outline" icon={paused ? "play_arrow" : "pause"} onClick={() => setPaused((value) => !value)}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>Clear</Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {visibleLogs.length === 0 ? (
            <span className="text-text-muted">No matching console logs.</span>
          ) : (
            <div className="space-y-0.5">
              {visibleLogs.map((line, i) => <div key={i}>{colorLine(line)}</div>)}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
