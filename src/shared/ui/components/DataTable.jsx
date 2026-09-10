/**
 * Accessible table for parent-owned rows. `rows` is never sliced here: pass the
 * current server/client page and its separately known `pagination.total`.
 *
 * @param {object} props
 * @param {Array<{key: string, label: React.ReactNode, align?: "left"|"center"|"right", mono?: boolean, width?: string|number, rowHeader?: boolean, sortDirection?: "ascending"|"descending"|"none", onSort?: () => void, render?: (row: object) => React.ReactNode}>} props.columns
 * @param {object[]} [props.rows=[]]
 * @param {(row: object, index: number) => React.Key} [props.keyFn]
 * @param {React.ReactNode} [props.caption] Table caption, announced to assistive technology.
 * @param {string} [props.ariaLabel="Data table"] Accessible name when no caption exists.
 * @param {"comfortable"|"compact"} [props.density="comfortable"]
 * @param {boolean} [props.framed=true] Bordered/rounded surface wrapper. Pass
 *   `false` when the table is embedded inside another surface (e.g. a Card) so
 *   it renders flat — spacing and row dividers carry the structure instead of
 *   a nested frame.
 * @param {React.ReactNode} [props.filterBar]
 * @param {object} [props.emptyState]
 * @param {boolean} [props.loading=false]
 * @param {object} [props.pagination] Parent-owned Pagination props.
 * @param {(row: object) => React.ReactNode} [props.renderExpandedRow]
 * @param {React.Key[]} [props.expandedRowKeys=[]]
 * @param {(keys: React.Key[]) => void} [props.onExpandedRowKeysChange]
 * @param {(row: object) => string} [props.getRowLabel]
 */
import { isFunction } from "@/shared/utils/typeChecks.js";
import EmptyState from "./EmptyState";
import Pagination from "./Pagination";

const DENSITY = {
  comfortable: "px-4 py-2.5",
  compact: "px-3 py-1.5",
};

const HEADER_ALIGN = { left: "text-start", center: "text-center", right: "text-end" };
const CELL_ALIGN = { left: "text-left", center: "text-center", right: "text-right dd-tnum" };

export default function DataTable({
  columns = [],
  rows = [],
  keyFn,
  caption,
  ariaLabel = "Data table",
  density = "comfortable",
  framed = true,
  filterBar,
  emptyState,
  loading = false,
  pagination,
  renderExpandedRow,
  expandedRowKeys = [],
  onExpandedRowKeysChange,
  getRowLabel,
}) {
  const cellPadding = DENSITY[density] ?? DENSITY.comfortable;
  const hasExpander = isFunction(renderExpandedRow) && isFunction(onExpandedRowKeysChange);
  const columnCount = Math.max(columns.length + Number(hasExpander), 1);
  const skeletonRowCount = Math.max(rows.length, 5);
  const keyFor = (row, index) => keyFn?.(row, index) ?? index;
  const toggleExpanded = (key) => {
    if (!onExpandedRowKeysChange) return;
    onExpandedRowKeysChange(
      expandedRowKeys.includes(key)
        ? expandedRowKeys.filter((expandedKey) => expandedKey !== key)
        : [...expandedRowKeys, key],
    );
  };

  return (
    <div className={framed ? "overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface" : undefined}>
      {filterBar ? <div className="flex flex-wrap items-center gap-2 border-b border-dd-border-subtle px-3 py-2">{filterBar}</div> : null}
      <div role="region" aria-label={`${caption ?? ariaLabel} rows`} tabIndex={0} className="overflow-x-auto outline-none focus-visible:shadow-dd-focus">
        <table className="w-full border-collapse text-left text-[13px] text-dd-text" aria-label={caption ? undefined : ariaLabel} aria-busy={loading || undefined}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className={`${framed ? "bg-dd-surface-2 " : ""}text-[11px] font-medium uppercase tracking-wide text-dd-muted`}>
            <tr>
              {hasExpander ? <th scope="col" className={`${cellPadding} w-11`}><span className="sr-only">Expand row</span></th> : null}
              {columns.map((column) => {
                const sortable = isFunction(column.onSort);
                return (
                  <th key={column.key} scope="col" aria-sort={column.sortDirection} style={column.width ? { width: column.width } : undefined} className={`p-0 ${HEADER_ALIGN[column.align ?? "left"]} font-medium`}>
                    {sortable ? <button type="button" onClick={column.onSort} className="flex min-h-11 w-full items-center gap-1 rounded-dd px-4 py-2.5 text-start outline-none focus-visible:shadow-dd-focus">{column.label}<span className="sr-only">, sort</span></button> : <span className={cellPadding}>{column.label}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: skeletonRowCount }, (_, rowIndex) => (
              <tr key={rowIndex} className="border-t border-dd-border-subtle">
                {Array.from({ length: columnCount }, (_, columnIndex) => <td key={columnIndex} className={cellPadding}><div className="h-3.5 animate-pulse rounded bg-dd-surface-3" style={{ width: `${45 + ((rowIndex * 23 + columnIndex * 31) % 45)}%` }} /></td>)}
              </tr>
            )) : rows.length === 0 ? (
              <tr className="border-t border-dd-border-subtle"><td colSpan={columnCount}><EmptyState {...(emptyState ?? { icon: "inbox", title: "No data to display" })} /></td></tr>
            ) : rows.map((row, rowIndex) => {
              const key = keyFor(row, rowIndex);
              const expanded = expandedRowKeys.includes(key);
              const rowLabel = getRowLabel?.(row) ?? `row ${rowIndex + 1}`;
              return [
                <tr key={key} className="border-t border-dd-border-subtle transition-colors hover:bg-dd-surface-2">
                  {hasExpander ? <td className={cellPadding}><button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${rowLabel}`} aria-expanded={expanded} onClick={() => toggleExpanded(key)} className="flex size-11 items-center justify-center rounded-dd text-dd-muted outline-none hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"><span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{expanded ? "expand_less" : "expand_more"}</span></button></td> : null}
                  {columns.map((column) => {
                    const Cell = column.rowHeader ? "th" : "td";
                    return <Cell key={column.key} scope={column.rowHeader ? "row" : undefined} className={[cellPadding, CELL_ALIGN[column.align ?? "left"], column.mono ? "font-mono dd-tnum text-xs" : null].filter(Boolean).join(" ")}>{column.render ? column.render(row) : row[column.key]}</Cell>;
                  })}
                </tr>,
                hasExpander && expanded ? <tr key={`${key}-expanded`} className="border-t border-dd-border-subtle bg-dd-surface-2"><td colSpan={columnCount} className={cellPadding}>{renderExpandedRow(row)}</td></tr> : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {pagination ? <div className="border-t border-dd-border-subtle px-3 py-2"><Pagination {...pagination} /></div> : null}
    </div>
  );
}
