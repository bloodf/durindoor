/**
 * Durin DS — Pagination
 *
 * Compact pager for tables and long lists. Left side carries an optional
 * rows-per-page control (rendered only when `rowsPerPage` is given, before
 * the summary) followed by an optional `rowsLabel` summary ("Showing 1 to 20
 * of 2,402 results"); when the label is absent but `total` is given, a
 * "<total> results" fallback is rendered. The pager itself is right-aligned:
 * ghost chevron icon buttons for prev/next, the current page uses
 * `bg-dd-accent text-dd-on-accent`, sibling pages use ghost buttons, and
 * ellipses mark skipped ranges. All buttons are real `<button>` elements with
 * the standard Durin DS focus ring and disabled states at the list edges.

 * The rows-per-page control uses a native `<select>` styled to match the
 * compact pager chrome, retaining native keyboard and dismissal behavior.
 *
 * The page window keeps 1 and `pageCount` anchored, shows the current page
 * plus one sibling on each side, and widens near the edges so no single-page
 * gap is ever hidden behind an ellipsis.
 *
 * @param {object} props
 * @param {number} props.page Current page (1-based).
 * @param {number} props.pageCount Total page count.
 * @param {number} [props.total] Total row count — used for the fallback summary.
 * @param {string} [props.rowsLabel] Left-side summary line (`text-xs text-dd-muted`).
 * @param {(page: number) => void} [props.onPage] Page-change callback.
 * @param {number|"all"} [props.rowsPerPage] Current rows-per-page value. The
 *   control is rendered only when this is provided.
 * @param {Array<number|"all">} [props.rowsPerPageOptions=[10,25,50,100,"all"]]
 *   Options offered in the rows-per-page select.
 * @param {(value: number|"all") => void} [props.onRowsPerPageChange]
 *   Rows-per-page change callback; emits a `number` or `"all"`. The parent
 *   owns pagination state and is responsible for resetting `page` to 1 when
 *   this fires.
 */
/**
 * Builds the ordered list of page numbers and ellipsis markers for the pager.
 * @returns {Array<{kind: "page", n: number} | {kind: "gap", key: string}>}
 *   Page and gap domain values.
 */
function getPageItems(page, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => ({ kind: "page", n: i + 1 }));
  }

  const current = Math.min(Math.max(page, 1), pageCount);
  const pages = new Set([1, pageCount]);
  for (let p = current - 1; p <= current + 1; p += 1) {
    if (p > 1 && p < pageCount) pages.add(p);
  }
  if (current <= 3) {
    for (const p of [2, 3, 4]) pages.add(p);
  }
  if (current >= pageCount - 2) {
    for (const p of [pageCount - 3, pageCount - 2, pageCount - 1]) pages.add(p);
  }

  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);
  const items = [];
  let previous = 0;
  for (const p of sorted) {
    if (p - previous > 1) items.push({ kind: "gap", key: `gap-${p}` });
    items.push({ kind: "page", n: p });
    previous = p;
  }
  return items;
}

const NAV_BUTTON =
  "flex size-7 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-40";
const PAGE_BUTTON =
  "flex size-7 items-center justify-center rounded-dd text-xs font-medium dd-tnum outline-none transition-colors focus-visible:shadow-dd-focus";
const PAGE_GHOST = `${PAGE_BUTTON} text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text`;
const PAGE_CURRENT = `${PAGE_BUTTON} bg-dd-accent text-dd-on-accent`;
const DEFAULT_ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100, "all"];

export default function Pagination({
  page,
  pageCount,
  total,
  rowsLabel,
  onPage,
  rowsPerPage,
  rowsPerPageOptions = DEFAULT_ROWS_PER_PAGE_OPTIONS,
  onRowsPerPageChange,
}) {
  const summary =
    rowsLabel ?? (Number.isFinite(total) ? `${total.toLocaleString()} results` : null);

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {rowsPerPage !== undefined ? (
        <label className="flex items-center gap-1.5 text-xs text-dd-muted">
          Rows:
          <span className="relative">
            <select
              aria-label="Rows per page"
              value={rowsPerPage}
              onChange={(event) => {
                const value = event.target.value;
                onRowsPerPageChange?.(value === "all" ? "all" : Number(value));
              }}
              className="h-7 appearance-none rounded-dd border border-dd-border bg-dd-surface py-0 pl-2 pr-7 text-xs text-dd-text outline-none hover:border-dd-border-subtle focus-visible:border-dd-accent focus-visible:shadow-dd-focus"
            >
              {rowsPerPageOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All" : option}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] leading-none text-dd-muted"
            >
              expand_more
            </span>
          </span>
        </label>
      ) : null}
      {summary ? <span className="text-xs text-dd-muted">{summary}</span> : null}
      {pageCount >= 1 ? (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage?.(page - 1)}
            className={NAV_BUTTON}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
              chevron_left
            </span>
          </button>
          {getPageItems(page, pageCount).map((item) =>
            item.kind === "gap" ? (
              <span
                key={item.key}
                aria-hidden="true"
                className="flex size-7 items-center justify-center text-xs text-dd-subtle"
              >
                …
              </span>
            ) : (
              <button
                key={item.n}
                type="button"
                aria-label={`Page ${item.n}`}
                aria-current={item.n === page ? "page" : undefined}
                onClick={() => onPage?.(item.n)}
                className={item.n === page ? PAGE_CURRENT : PAGE_GHOST}
              >
                {item.n}
              </button>
            ),
          )}
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPage?.(page + 1)}
            className={NAV_BUTTON}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
              chevron_right
            </span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}
