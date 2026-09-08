"use client";

import { useEffect, useMemo, useState } from "react";
import DataTable from "@/shared/ui/components/DataTable.jsx";

const fmt = (value) => new Intl.NumberFormat().format(value || 0);
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const columns = [
  { key: "comboName", label: "Combo", render: (row) => <span className="font-medium">{row.comboName}</span> },
  { key: "connectionId", label: "Connection", mono: true, render: (row) => row.connectionId || "No connection recorded" },
  { key: "requests", label: "Requests", align: "right", render: (row) => fmt(row.requests) },
  { key: "promptTokens", label: "Input", align: "right", render: (row) => fmt(row.promptTokens) },
  { key: "completionTokens", label: "Output", align: "right", render: (row) => fmt(row.completionTokens) },
  { key: "cost", label: "Est. cost", align: "right", render: (row) => money(row.cost) },
];

export default function ComboUsageReport({ period, customRange, resetNonce }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const params = useMemo(() => {
    const value = new URLSearchParams({ period });
    if (customRange?.startDate && customRange?.endDate) {
      value.set("startDate", customRange.startDate);
      value.set("endDate", customRange.endDate);
    }
    return value.toString();
  }, [period, customRange?.startDate, customRange?.endDate]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/usage/combos?${params}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!controller.signal.aborted) { setReport(data); setPage(1); } })
      .catch((error) => { if (error?.name !== "AbortError") console.error("Failed to fetch combo usage report:", error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params, resetNonce]);

  const rows = report?.rows || [];
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const visibleRows = rowsPerPage === "all" ? rows : rows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const unattributed = report?.unattributed;

  return <section className="flex flex-col gap-3" aria-labelledby="combo-usage-title">
    <div>
      <h2 id="combo-usage-title" className="text-base font-semibold text-dd-text">Combo connection usage</h2>
      <p className="text-[13px] text-dd-muted">{report?.boundary || "Loading attribution boundary…"}</p>
    </div>
    <DataTable columns={columns} rows={visibleRows} keyFn={(row) => `${row.comboId}:${row.connectionId || "none"}`} density="compact" loading={loading}
      emptyState={{ icon: "account_tree", title: "No attributed combo usage in this range" }}
      pagination={{ page, pageCount, total: rows.length, onPage: setPage, rowsPerPage, onRowsPerPageChange: (value) => { setRowsPerPage(value); setPage(1); } }} />
    {unattributed && <div className="rounded-dd border border-dd-border bg-dd-surface-2 p-3 text-[13px] text-dd-muted">
      <strong className="text-dd-text">Not attributed to a combo:</strong> {fmt(unattributed.requests)} requests, {fmt(unattributed.promptTokens)} input tokens, {fmt(unattributed.completionTokens)} output tokens, {money(unattributed.cost)}. Includes history recorded before combo attribution and direct requests in selected range.
    </div>}
  </section>;
}
