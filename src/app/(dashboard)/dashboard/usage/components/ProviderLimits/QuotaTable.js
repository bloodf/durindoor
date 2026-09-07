"use client";

import { useEffect, useMemo, useState } from "react";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import Pagination from "@/shared/ui/components/Pagination.jsx";
import IconButton from "@/shared/ui/components/IconButton.jsx";
import { formatResetTime, getRemainingPercentage } from "./utils";
import { isFunction } from "../../../../../../shared/utils/typeChecks.js";

const PAGE_SIZE = 10;

const TONES = {
  healthy: { text: "text-dd-success", bar: "bg-dd-success", surface: "bg-dd-surface-2" },
  warning: { text: "text-dd-warning", bar: "bg-dd-warning", surface: "bg-dd-surface-2" },
  danger: { text: "text-dd-danger", bar: "bg-dd-danger", surface: "bg-dd-surface-2" },
};

function toneFor(remaining) {
  if (remaining > 70) return TONES.healthy;
  if (remaining >= 30) return TONES.warning;
  return TONES.danger;
}

function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    const timeStr = resetDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    return resetDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return null;
  }
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  if (sortMode === "remaining-desc") return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  return quotas;
}

/** Token-backed quota table: DS DataTable + Pagination, preserving sort/hide/compact contract. */
export default function QuotaTable({ quotas = [], compact = false, sortMode = "default", showSortLabel = false, onHideQuota = null }) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({ ...quota, index, remaining: getRemainingPercentage(quota) })),
    [quotas],
  );
  const sortedQuotas = useMemo(() => sortQuotas(normalizedQuotas, sortMode), [normalizedQuotas, sortMode]);
  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  useEffect(() => { setPage(1); }, [sortMode, quotas]);
  useEffect(() => { setPage((currentPage) => Math.min(currentPage, totalPages)); }, [totalPages]);

  if (!quotas || quotas.length === 0) return null;

  const hasHideAction = isFunction(onHideQuota);
  const currentPageRows = sortedQuotas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const density = compact ? "compact" : "comfortable";

  const columns = [
    {
      key: "name",
      label: "Quota",
      rowHeader: true,
      render: (quota) => <span className={`truncate font-medium text-dd-text ${compact ? "text-[11px]" : "text-[13px]"}`}>{quota.name}</span>,
    },
    {
      key: "remaining",
      label: "Remaining",
      render: (quota) => {
        const tone = toneFor(quota.remaining);
        return (
          <div className="flex flex-col gap-1">
            <div className={`${compact ? "h-1" : "h-1.5"} overflow-hidden rounded-dd ${tone.surface}`} role="progressbar" aria-label={`${quota.name} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={quota.remaining}>
              <div className={`h-full rounded-dd ${tone.bar} transition-[width] motion-reduce:transition-none`} style={{ width: `${Math.min(quota.remaining, 100)}%` }} />
            </div>
            <div className={`flex items-center justify-between ${compact ? "text-[10px]" : "text-xs"} text-dd-muted`}>
              <span className="dd-tnum">{quota.used.toLocaleString()} / {quota.total > 0 ? quota.total.toLocaleString() : "∞"}</span>
              <span className={`dd-tnum font-medium ${tone.text}`}>{quota.remaining}%</span>
            </div>
          </div>
        );
      },
    },
    {
      key: "reset",
      label: "Reset",
      render: (quota) => {
        const countdown = formatResetTime(quota.resetAt);
        const resetDisplay = formatResetTimeDisplay(quota.resetAt);
        const recurring = quota.recurring !== false;
        const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;
        if (countdown === "-" && !resetDisplay) {
          return <span className={`italic text-dd-subtle ${compact ? "text-[11px]" : "text-[13px]"}`}>N/A</span>;
        }
        if (compact) {
          return <span className="truncate text-[11px] font-medium text-dd-text" title={resetDisplay || ""}>{countdown !== "-" ? countdownLabel : resetDisplay}</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {countdown !== "-" ? <span className="text-[13px] font-medium text-dd-text">{countdownLabel}</span> : null}
            {resetDisplay ? <span className="text-xs text-dd-muted">{resetDisplay}</span> : null}
          </div>
        );
      },
    },
    ...(hasHideAction
      ? [{
          key: "hide",
          label: "",
          align: "right",
          render: (quota) => <IconButton label={`Hide quota ${quota.name}`} icon="visibility_off" size="sm" onClick={() => onHideQuota(quota)} />,
        }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-[11px] text-dd-muted">
        <span>{sortedQuotas.length} quota{sortedQuotas.length !== 1 ? "s" : ""}</span>
        {showSortLabel ? <span className="rounded-dd border border-dd-border bg-dd-surface-2 px-2 py-1 text-[11px] text-dd-muted">Sorted by account remaining</span> : null}
      </div>
      <DataTable columns={columns} rows={currentPageRows} keyFn={(quota) => `${quota.name}-${quota.index}`} density={density} caption="Provider quotas" />
      {totalPages > 1 ? (
        <Pagination
          page={page}
          pageCount={totalPages}
          total={sortedQuotas.length}
          rowsLabel={`Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, sortedQuotas.length)} of ${sortedQuotas.length}`}
          onPage={setPage}
        />
      ) : null}
    </div>
  );
}
