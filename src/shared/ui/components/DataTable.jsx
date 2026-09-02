/**
 * Durin DS — DataTable
 *
 * Token-backed data table with a real `<table>` for semantics and keyboard
 * navigation. Layout: outer `bg-dd-surface border border-dd-border
 * rounded-dd-lg overflow-hidden` card, an optional `filterBar` strip above
 * the grid, an uppercase muted header row on `bg-dd-surface-2`, body rows
 * divided by `border-dd-border-subtle` with a `hover:bg-dd-surface-2`
 * highlight, and an optional `pagination` footer (a Pagination props object).
 *
 * Column conventions: `mono` columns render `font-mono dd-tnum text-xs`;
 * right-aligned numeric columns get `text-right dd-tnum`; `render?(row)`
 * overrides the cell content (use it for soft status badges — see
 * DataTable.stories.jsx). `loading` swaps the body for pulsing skeleton rows
 * (matching `rows.length` when rows are present, else 5) and sets
 * `aria-busy`; when `rows` is empty the `emptyState` props object is rendered
 * via EmptyState inside a single spanning row (a minimal default is used when
 * `emptyState` is omitted).
 *
 * @param {object} props
 * @param {Array<{ key: string, label: React.ReactNode, align?: "left"|"right"|"center",
 *   mono?: boolean, width?: string|number, render?: (row: object) => React.ReactNode }>} props.columns
 * @param {object[]} [props.rows=[]]
 * @param {(row: object) => React.Key} props.keyFn Row key extractor.
 * @param {"comfortable"|"compact"} [props.density="comfortable"]
 *   comfortable = `px-4 py-2.5`, compact = `px-3 py-1.5`.
 * @param {React.ReactNode} [props.filterBar] Rendered in a bar above the table.
 * @param {object} [props.emptyState] EmptyState props, shown when `rows` is empty.
 * @param {boolean} [props.loading=false] Shows skeleton rows instead of data.
 * @param {{ page: number, pageCount: number, total?: number, rowsLabel?: string,
 *   onPage?: (page: number) => void, rowsPerPage?: number|"all",
 *   rowsPerPageOptions?: Array<number|"all">,
 *   onRowsPerPageChange?: (value: number|"all") => void }} [props.pagination]
 *   Pagination props rendered in a footer bar. The parent owns slicing and
 *   resets `page` to 1 when `onRowsPerPageChange` fires.
 */
import EmptyState from "./EmptyState";
import Pagination from "./Pagination";

const DENSITY = {
  comfortable: "px-4 py-2.5",
  compact: "px-3 py-1.5",
};

const HEADER_ALIGN = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const CELL_ALIGN = {
  left: "text-left",
  center: "text-center",
  right: "text-right dd-tnum",
};

export default function DataTable({
  columns,
  rows = [],
  keyFn,
  density = "comfortable",
  filterBar,
  emptyState,
  loading = false,
  pagination,
}) {
  const cellPadding = DENSITY[density] ?? DENSITY.comfortable;
  const columnCount = Math.max(columns.length, 1);
  const skeletonRowCount = rows.length > 0 ? rows.length : 5;

  return (
    <div className="overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface">
      {filterBar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-dd-border-subtle px-3 py-2">
          {filterBar}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-left text-[13px] text-dd-text"
          aria-busy={loading || undefined}
        >
          <thead className="bg-dd-surface-2 text-[11px] font-medium uppercase tracking-wide text-dd-muted">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`${cellPadding} ${HEADER_ALIGN[column.align ?? "left"]} font-medium`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRowCount }, (_, rowIndex) => (
                <tr key={rowIndex} className="border-t border-dd-border-subtle">
                  {columns.map((column, columnIndex) => (
                    <td key={column.key} className={cellPadding}>
                      <div
                        className="h-3.5 animate-pulse rounded bg-dd-surface-3"
                        style={{ width: `${45 + ((rowIndex * 23 + columnIndex * 31) % 45)}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr className="border-t border-dd-border-subtle">
                <td colSpan={columnCount}>
                  <EmptyState
                    {...(emptyState ?? { icon: "inbox", title: "No data to display" })}
                  />
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr
                  key={keyFn ? keyFn(row) : rowIndex}
                  className="border-t border-dd-border-subtle transition-colors hover:bg-dd-surface-2"
                >
                  {columns.map((column) => {
                    const cellClassName = [
                      cellPadding,
                      CELL_ALIGN[column.align ?? "left"],
                      column.mono ? "font-mono dd-tnum text-xs" : null,
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td key={column.key} className={cellClassName}>
                        {column.render ? column.render(row) : row[column.key]}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <div className="border-t border-dd-border-subtle px-3 py-2">
          <Pagination {...pagination} />
        </div>
      ) : null}
    </div>
  );
}
