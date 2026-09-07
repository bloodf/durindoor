"use client";

import { cn } from "@/shared/utils/cn";
import DSPagination from "@/shared/ui/components/Pagination.jsx";
const DEFAULT_ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100, "all"];
export default function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  rowsPerPageOptions = DEFAULT_ROWS_PER_PAGE_OPTIONS,
  className,
}) {
  const isAll = pageSize === "all";
  // Guarantee the controlled value always has a matching <option>: a caller
  // mid-migration to the canonical `[10,25,50,100,"all"]` set (e.g. still
  // passing `pageSize={20}`) must not render a phantom-selected native select.
  const resolvedOptions = !isAll && !rowsPerPageOptions.includes(pageSize)
    ? [...rowsPerPageOptions.filter((option) => option !== "all"), pageSize].sort((a, b) => a - b).concat(rowsPerPageOptions.includes("all") ? ["all"] : [])
    : rowsPerPageOptions;
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems > 0 ? (isAll ? 1 : (currentPage - 1) * pageSize + 1) : 0;
  const endItem = isAll ? totalItems : Math.min(currentPage * pageSize, totalItems);
  const rowsLabel = totalItems > 0 ? `Showing ${startItem} to ${endItem} of ${totalItems} results` : "No results";

  return (
    <div className={cn("flex flex-col items-center justify-between gap-4 py-4 px-2 sm:flex-row", className)}>
      <div className="text-xs text-dd-muted">{rowsLabel}</div>
      <DSPagination
        page={currentPage}
        pageCount={totalPages}
        total={totalItems}
        rowsLabel=""
        onPage={onPageChange}
        rowsPerPage={onPageSizeChange ? pageSize : undefined}
        rowsPerPageOptions={resolvedOptions}
        onRowsPerPageChange={onPageSizeChange}
      />
    </div>
  );
}
