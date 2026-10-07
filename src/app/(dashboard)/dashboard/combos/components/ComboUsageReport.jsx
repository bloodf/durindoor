"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import { buildConnectionNameMap, connectionDisplayName } from "@/shared/utils/connectionDisplay.js";

const fmt = (value) => new Intl.NumberFormat().format(value || 0);
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const buildColumns = (connectionNames) => [
  { key: "comboName", label: "Combo", render: (row) => <span className="font-medium text-dd-text">{row.comboName}</span> },
  { key: "connectionId", label: "Connection", mono: true, render: (row) => row.connectionId ? connectionDisplayName(row.connectionId, connectionNames) : <span className="text-dd-muted">No connection recorded</span> },
  { key: "requests", label: "Requests", align: "right", mono: true, render: (row) => fmt(row.requests) },
  { key: "promptTokens", label: "Input", align: "right", mono: true, render: (row) => fmt(row.promptTokens) },
  { key: "completionTokens", label: "Output", align: "right", mono: true, render: (row) => fmt(row.completionTokens) },
  { key: "cost", label: "Est. cost", align: "right", mono: true, render: (row) => <span className="text-dd-warning">{money(row.cost)}</span> },
];

export default function ComboUsageReport({ period, customRange, resetNonce }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [connectionNames, setConnectionNames] = useState({});
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
    setError(null);
    fetch(`/api/usage/combos?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Combo usage request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setReport(data);
          setPage(1);
        }
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.error("Failed to fetch combo usage report:", err);
          setError(err.message || "Failed to fetch combo usage report");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, resetNonce]);

  // Connection ids render as names; fetch the catalog once (fail-open).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled && body) setConnectionNames(buildConnectionNameMap(body.connections)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const columns = useMemo(() => buildColumns(connectionNames), [connectionNames]);

  const rows = report?.rows || [];
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const visibleRows = rowsPerPage === "all" ? rows : rows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const unattributed = report?.unattributed;

  return (
    <Card padding={false} className="flex min-w-0 flex-col gap-0">
      <CardHeader icon="account_tree" title="Combo connection usage" subtitle={report?.boundary || "Loading attribution boundary…"} />
      <CardContent className="p-0">
        <DataTable
          framed={false}
          columns={columns}
          rows={visibleRows}
          keyFn={(row) => `${row.comboId}:${row.connectionId || "none"}`}
          density="compact"
          loading={loading}
          emptyState={{ icon: "account_tree", title: "No attributed combo usage in this range" }}
          pagination={{
            page,
            pageCount,
            total: rows.length,
            onPage: setPage,
            rowsPerPage,
            onRowsPerPageChange: (value) => {
              setRowsPerPage(value);
              setPage(1);
            },
          }}
        />
      </CardContent>
      {error ? (
        <div role="alert" className="border-t border-dd-danger bg-dd-surface-2 p-3 text-[13px] text-dd-danger">{error}</div>
      ) : null}
      {unattributed ? (
        <div className="border-t border-dd-border-subtle p-3 text-[13px] text-dd-muted">
          <strong className="text-dd-text">Not attributed to a combo:</strong> {fmt(unattributed.requests)} requests, {fmt(unattributed.promptTokens)} input tokens, {fmt(unattributed.completionTokens)} output tokens, {money(unattributed.cost)}. Includes history recorded before combo attribution and direct requests in selected range.
        </div>
      ) : null}
    </Card>
  );
}
