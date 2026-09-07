"use client";

import { useMemo, useState, useEffect } from "react";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Select from "@/shared/ui/components/Select.jsx";
import Toggle from "@/shared/ui/components/Toggle.jsx";
import { usePagination } from "@/shared/hooks/usePagination";
import { isString } from "@/shared/utils/typeChecks";

const STATUS_TONES = {
  OK: "success",
  PENDING: "info",
  FAILED: "danger",
};

const STATUS_ICON = {
  success: "check_circle",
  info: "progress_activity",
  danger: "error",
};
const STATUS_TONE_CLASS = {
  success: "bg-dd-success/10 text-dd-success border-dd-success/20",
  info: "bg-dd-info/10 text-dd-info border-dd-info/20",
  danger: "bg-dd-danger/10 text-dd-danger border-dd-danger/20",
};

const LOG_COLUMN_DEFS = [
  { key: "datetime", label: "DateTime", align: "left" },
  { key: "model", label: "Model", align: "left" },
  { key: "provider", label: "Provider", align: "left" },
  { key: "account", label: "Account", align: "left" },
  { key: "in", label: "In", align: "right" },
  { key: "out", label: "Out", align: "right" },
  { key: "status", label: "Status", align: "left" },
];

function parseLogParts(log) {
  const parts = isString(log) ? log.split(" | ") : [];
  if (parts.length < 7) return null;
  const status = parts[6];
  const tone = status.includes("OK")
    ? STATUS_TONES.OK
    : status.includes("FAILED")
    ? STATUS_TONES.FAILED
    : status.includes("PENDING")
    ? STATUS_TONES.PENDING
    : "neutral";
  return { datetime: parts[0], model: parts[1], provider: parts[2], account: parts[3], in: parts[4], out: parts[5], status, tone };
}


export default function RequestLogger({ resetNonce = 0 } = {}) {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
        setError(null);
      } else {
        setError("Failed to load request logs.");
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
      setError("Failed to load request logs.");
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const validLogs = useMemo(() => logs.filter((log) => isString(log) && log.split(" | ").length >= 7), [logs]);

  const parsedRows = useMemo(() => validLogs.map((log) => parseLogParts(log)).filter(Boolean), [validLogs]);

  const {
    pageItems,
    page,
    pageSize,
    setPage,
    setPageSize,
    totalItems,
    totalPages,
  } = usePagination({
    items: parsedRows,
    pageSize: 20,
    resetKey: resetNonce,
  });

  const columns = LOG_COLUMN_DEFS.map((column) => ({
    ...column,
    key: column.key,
    mono: column.key === "in" || column.key === "out",
    rowHeader: column.key === "datetime",
    render: (row) => {
      if (column.key === "provider") return <span className="inline-flex items-center rounded-dd border border-dd-border bg-dd-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-dd-muted">{row.provider}</span>;
      if (column.key === "in") return <span className="text-dd-accent">{row.in}</span>;
      if (column.key === "out") return <span className="text-dd-accent-2">{row.out}</span>;
      if (column.key === "datetime") return <span className="text-dd-muted">{row.datetime}</span>;
      if (column.key === "model") return <span className="font-medium text-dd-text">{row.model}</span>;
      if (column.key === "account") return <span className="block max-w-[150px] truncate" title={row.account}>{row.account}</span>;
      if (column.key === "status") return <span className={["inline-flex items-center gap-1 rounded-dd border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", STATUS_TONE_CLASS[row.tone] || "border-dd-border bg-dd-surface-2 text-dd-muted", row.tone === "info" ? "animate-pulse" : ""].join(" ")}><span aria-hidden="true" className="material-symbols-outlined text-[12px] leading-none">{STATUS_ICON[row.tone] || "circle"}</span><span className="sr-only">Status: </span>{row.status}</span>;
      return row[column.key];
    },
  }));
  const summaryText = Number.isFinite(totalItems) ? `${totalItems.toLocaleString()} log entries` : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-dd-text">Request Logs</h2>
        <Toggle
          aria-label="Auto refresh every 3 seconds"
          checked={autoRefresh}
          onChange={setAutoRefresh}
          size="sm"
          label="Auto Refresh (3s)"
          description="Polls the request history database every 3 seconds while enabled."
        />
      </div>

      {error ? <div role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-[13px] text-dd-danger">{error}</div> : null}
      <DataTable
        columns={columns}
        rows={pageItems}
        keyFn={(row, index) => `${(page - 1) * pageSize + index}-${row.datetime}-${row.status}`}
        caption="Request logs streamed from the request history database."
        density="compact"
        loading={loading && parsedRows.length === 0}
        filterBar={<Select aria-label="Logs per page" size="sm" value={pageSize === parsedRows.length && parsedRows.length > 20 ? "all" : pageSize} onChange={(value) => setPageSize(value === "all" ? parsedRows.length || 20 : Number(value))} options={[10, 25, 50, 100, "all"].map((value) => ({ value, label: value === "all" ? "All rows" : `${value} rows` }))} className="w-40" />}
        pagination={totalPages > 1 ? { page, pageCount: totalPages, total: totalItems, onPage: setPage, rowsLabel: summaryText } : undefined}
      />
      <p className="text-[11px] italic text-dd-muted">Logs are loaded from the request history database.</p>
    </div>
  );
}
