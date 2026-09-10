"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, CardHeader, CardContent } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import { usePagination } from "@/shared/hooks/usePagination";
import { formatCompactToken } from "@/shared/utils/formatCompact";
import { isUndefined } from "@/shared/utils/typeChecks";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

function fmtTime(iso) {
  if (!iso) return "Never";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function pendingBadge(pending, neutralTone = "neutral") {
  if (pending > 0) {
    return <Badge tone="accent" size="sm">{fmt(pending)} pending</Badge>;
  }
  return <Badge tone={neutralTone} size="sm">Settled</Badge>;
}

function summaryTokenColumn(field, label) {
  return {
    key: field,
    label,
    align: "right",
    mono: true,
    render: (summary) => {
      const compact = formatCompactToken(summary[field]);
      return (
        <span role="img" className="dd-tnum" title={compact.title} aria-label={compact.title}>
          {compact.display}
        </span>
      );
    },
  };
}

function summaryCostColumn(field, label) {
  return {
    key: field,
    label,
    align: "right",
    mono: true,
    render: (summary) => (
      <span className="dd-tnum text-dd-warning">{fmtCost(summary[field])}</span>
    ),
  };
}

/**
 * Build the trailing value columns based on viewMode ("tokens" | "costs").
 * Exposed so the caller's `groupColumns` can extend the same axis.
 */
export function buildValueColumns(viewMode) {
  if (viewMode === "costs") {
    return [
      summaryCostColumn("inputCost", "Input Cost"),
      summaryCostColumn("cachedCost", "Cached Cost"),
      summaryCostColumn("cacheCreationCost", "Cache Write"),
      summaryCostColumn("outputCost", "Output Cost"),
      summaryCostColumn("reasoningCost", "Reasoning Cost"),
      summaryCostColumn("cost", "Total Cost"),
    ];
  }
  return [
    summaryTokenColumn("promptTokens", "Input"),
    summaryTokenColumn("cachedTokens", "Cached"),
    summaryTokenColumn("cacheCreationTokens", "Cache Write"),
    summaryTokenColumn("completionTokens", "Output"),
    summaryTokenColumn("reasoningTokens", "Reasoning"),
    summaryTokenColumn("totalTokens", "Total"),
  ];
}

function buildDetailValueColumns(viewMode) {
  if (viewMode === "costs") {
    return [
      summaryCostColumn("inputCost", "Input"),
      summaryCostColumn("cachedCost", "Cached"),
      summaryCostColumn("cacheCreationCost", "Cache Write"),
      summaryCostColumn("outputCost", "Output"),
      summaryCostColumn("reasoningCost", "Reasoning"),
      summaryCostColumn("cost", "Total"),
    ];
  }
  return [
    summaryTokenColumn("promptTokens", "Input"),
    summaryTokenColumn("cachedTokens", "Cached"),
    summaryTokenColumn("cacheCreationTokens", "Cache Write"),
    summaryTokenColumn("completionTokens", "Output"),
    summaryTokenColumn("reasoningTokens", "Reasoning"),
    summaryTokenColumn("totalTokens", "Total"),
  ];
}

const GROUP_ROW_LABEL_TONE = "font-medium text-dd-text";

/**
 * Reusable sortable usage table with expandable group rows.
 * Durin DS strict contract: parent (UsageStats) supplies:
 *   - `groupColumns`     [{ key, label, align?, mono?, render: (summary) => ReactNode }]  - summary row cells
 *   - `detailColumns`    [{ key, label, align?, mono?, render: (item) => ReactNode }]     - detail row cells
 *   - `detailValueColumns` (optional, overrides built-in trailing value columns)
 *   - `groupKeyRender`   (optional) (summary) => ReactNode for the row-header cell
 *   - `valueMode`        "tokens" | "costs"   drives trailing value columns
 *
 * Each expanded group renders its detail rows inside a nested DS DataTable.
 * Both tables render frameless (`framed={false}`): the surrounding Card (and
 * the expanded-row inset surface) is already the frame, so a second bordered
 * wrapper would produce a nested "card in a card".
 *
 * Sort: `sortBy` + `sortOrder` drive a header button per column. Click
 * callbacks flow through `onToggleSort(tableType, field)`.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {Array<{key:string,label:string,align?:string,mono?:boolean,render?:(row:object)=>React.ReactNode}>} props.groupColumns
 * @param {Array<{key:string,label:string,align?:string,mono?:boolean,render?:(row:object)=>React.ReactNode}>} props.detailColumns
 * @param {Array<{key:string,label:string,align?:string,mono?:boolean,render?:(row:object)=>React.ReactNode}>} [props.detailValueColumns]
 * @param {Array} props.groupedData
 * @param {string} props.tableType
 * @param {string} props.sortBy
 * @param {string} props.sortOrder
 * @param {(tableType:string, field:string) => void} props.onToggleSort
 * @param {"tokens"|"costs"} props.valueMode
 * @param {string} props.storageKey
 * @param {(summary:object) => React.ReactNode} [props.groupKeyRender]
 * @param {string} props.emptyMessage
 */
export default function UsageTable({
  title,
  groupColumns = [],
  detailColumns = [],
  detailValueColumns,
  groupedData = [],
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  valueMode = "tokens",
  storageKey,
  groupKeyRender,
  emptyMessage,
}) {
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    try {
      const saved = !isUndefined(globalThis.localStorage) ? globalThis.localStorage.getItem(storageKey) : null;
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      if (!isUndefined(globalThis.localStorage)) {
        globalThis.localStorage.setItem(storageKey, JSON.stringify([...expanded]));
      }
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }, []);

  const trailingValueColumns = useMemo(
    () => detailValueColumns ?? buildDetailValueColumns(valueMode),
    [detailValueColumns, valueMode],
  );

  const { pageItems: pageGroups, page, pageSize, setPage, setPageSize, totalItems, totalPages } = usePagination({
    items: groupedData,
    pageSize: 20,
    resetKey: `${tableType}-${sortBy}-${sortOrder}-${valueMode}`,
  });

  const headerColumns = useMemo(() => {
    const cols = [
      {
        key: "__group",
        label: "Group",
        render: (row) => row.__group,
        rowHeader: true,
      },
      ...groupColumns.map((col) => ({
        key: col.key,
        label: (
          <span className="inline-flex items-center gap-1">
            <span>{col.label}</span>
            {col.key === sortBy
              ? <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-dd-accent">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>
              : <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-dd-subtle opacity-50">sort</span>}
          </span>
        ),
        align: col.align ?? "left",
        mono: col.mono,
        sortDirection: col.key === sortBy ? (sortOrder === "asc" ? "ascending" : "descending") : "none",
        onSort: () => onToggleSort(tableType, col.key),
        render: (row) => col.render?.(row),
      })),
      ...trailingValueColumns.map((col) => ({
        key: col.key,
        label: (
          <span className="inline-flex items-center gap-1">
            <span>{col.label}</span>
            {col.key === sortBy
              ? <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-dd-accent">{sortOrder === "asc" ? "arrow_upward" : "arrow_downward"}</span>
              : <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-dd-subtle opacity-50">sort</span>}
          </span>
        ),
        align: col.align ?? "right",
        mono: col.mono ?? true,
        sortDirection: col.key === sortBy ? (sortOrder === "asc" ? "ascending" : "descending") : "none",
        onSort: () => onToggleSort(tableType, col.key),
        render: (row) => col.render?.(row),
      })),
    ];
    return cols;
  }, [groupColumns, trailingValueColumns, sortBy, sortOrder, tableType, onToggleSort]);

  const detailTable = useCallback((group) => {
    const rows = group.items;
    const detailHeaderColumns = [
      ...detailColumns.map((col) => ({
        key: col.key,
        label: col.label,
        align: col.align ?? "left",
        mono: col.mono,
        render: (row) => col.render?.(row),
      })),
      ...trailingValueColumns.map((col) => ({
        key: col.key,
        label: col.label,
        align: col.align ?? "right",
        mono: col.mono ?? true,
        render: (row) => col.render?.(row),
      })),
    ];
    return (
      <DataTable
        framed={false}
        columns={detailHeaderColumns}
        rows={rows}
        keyFn={(item, index) => {
          if (item && item.key != null) return `${group.groupKey}-${item.key}`;
          if (item?.rawModel) return `${group.groupKey}-${item.rawModel}`;
          if (item?.endpoint) return `${group.groupKey}-${item.endpoint}`;
          if (item?.keyName) return `${group.groupKey}-${item.keyName}`;
          if (item?.accountName) return `${group.groupKey}-${item.accountName}`;
          return `${group.groupKey}-detail-${index}`;
        }}
        density="compact"
        emptyState={{ icon: "inbox", title: "No items" }}
        caption={`Items for ${group.groupKey}`}
        getRowLabel={(item) => item?.rawModel ?? item?.endpoint ?? item?.keyName ?? item?.accountName ?? item?.key ?? "row"}
      />
    );
  }, [detailColumns, trailingValueColumns]);

  const summaryRows = useMemo(() => pageGroups.map((group) => ({
    ...group,
    ...(group.summary || {}),
    __group: (
      <div className="flex min-w-0 items-center gap-2">
        <span className={GROUP_ROW_LABEL_TONE}>
          {groupKeyRender ? groupKeyRender(group) : group.groupKey}
        </span>
        {group.summary?.pending > 0 ? pendingBadge(group.summary.pending) : null}
      </div>
    ),
  })), [pageGroups, groupKeyRender]);

  const renderExpandedRow = useCallback((row) => (
    <div className="px-3 py-2">{detailTable(row)}</div>
  ), [detailTable]);

  const getRowLabel = useCallback((row) => `Group ${row.groupKey}`, []);

  const paginationProps = totalPages > 1
    ? {
        page,
        pageCount: totalPages,
        total: totalItems,
        onPage: setPage,
        rowsPerPage: pageSize,
        onRowsPerPageChange: (size) => { setPageSize(size); setPage(1); },
        rowsLabel: `Showing page ${page} of ${totalPages} (${totalItems} groups)`,
      }
    : null;

  return (
    <Card padding={false} className="flex min-w-0 flex-col gap-0">
      {title ? (
        <CardHeader icon="table_chart" title={title} />
      ) : null}
      <CardContent className="p-0">
        <DataTable
          framed={false}
          columns={headerColumns}
          rows={summaryRows}
          keyFn={(row) => row.groupKey}
          density="compact"
          renderExpandedRow={renderExpandedRow}
          expandedRowKeys={Array.from(expanded)}
          onExpandedRowKeysChange={(keys) => {
            setExpanded((prev) => {
              const currentPage = new Set(pageGroups.map((g) => g.groupKey));
              const merged = new Set([...prev].filter((k) => !currentPage.has(k)));
              keys.forEach((k) => merged.add(k));
              return merged;
            });
          }}
          getRowLabel={getRowLabel}
          emptyState={{ icon: "inbox", title: emptyMessage || "Nothing to show" }}
          pagination={paginationProps ?? undefined}
        />
      </CardContent>
    </Card>
  );
}

UsageTable.propTypes = {
  title: PropTypes.string,
  groupColumns: PropTypes.array.isRequired,
  detailColumns: PropTypes.array.isRequired,
  detailValueColumns: PropTypes.array,
  groupedData: PropTypes.array.isRequired,
  tableType: PropTypes.string.isRequired,
  sortBy: PropTypes.string.isRequired,
  sortOrder: PropTypes.string.isRequired,
  onToggleSort: PropTypes.func.isRequired,
  valueMode: PropTypes.string,
  storageKey: PropTypes.string.isRequired,
  groupKeyRender: PropTypes.func,
  emptyMessage: PropTypes.string,
};

// Re-export utilities for use in UsageStats orchestrator
export { fmt, fmtCost, fmtTime, formatCompactToken };
