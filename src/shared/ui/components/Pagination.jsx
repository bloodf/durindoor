/**
 * @param {object} props
 * @param {number} props.page Current page (1-based).
 * @param {number} props.pageCount Total page count.
 * @param {number} [props.total]
 * @param {string} [props.rowsLabel]
 * @param {(page: number) => void} [props.onPage]
 * @param {number|"all"} [props.rowsPerPage]
 * @param {Array<number|"all">} [props.rowsPerPageOptions=[10,25,50,100,"all"]]
 * @param {(value: number|"all") => void} [props.onRowsPerPageChange]
 */
function toSafePage(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function toSafePageCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function getPageItems(page, pageCount) {
  if (pageCount <= 1) return [{ kind: "page", n: 1 }];
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => ({ kind: "page", n: i + 1 }));
  const current = Math.min(Math.max(page, 1), pageCount);
  const pages = new Set([1, pageCount, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const items = [];
  let previous = 0;
  for (const p of sorted) {
    if (p - previous > 1) items.push({ kind: "gap", key: `gap-${p}` });
    items.push({ kind: "page", n: p });
    previous = p;
  }
  return items;
}

const NAV_BUTTON = "flex min-h-11 min-w-11 items-center justify-center rounded-dd px-3 text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-40";
const PAGE_BUTTON = "flex min-h-11 min-w-11 items-center justify-center rounded-dd px-2 text-xs font-medium dd-tnum outline-none transition-colors focus-visible:shadow-dd-focus";
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
  const safePage = toSafePage(page);
  const safePageCount = toSafePageCount(pageCount);
  const clampedPage = Math.min(safePage, safePageCount);
  const summary = rowsLabel ?? (Number.isFinite(total) && total !== null ? `${total.toLocaleString()} results` : null);

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {rowsPerPage !== undefined ? (
        <label className="flex items-center gap-1.5 text-xs text-dd-muted">
          Rows:
          <span className="relative">
            <select aria-label="Rows per page" value={rowsPerPage} onChange={(event) => onRowsPerPageChange?.(event.target.value === "all" ? "all" : Number(event.target.value))} className="h-11 appearance-none rounded-dd border border-dd-border bg-dd-surface py-0 ps-3 pe-9 text-xs text-dd-text outline-none hover:border-dd-border-subtle focus-visible:border-dd-accent focus-visible:shadow-dd-focus">
              {rowsPerPageOptions.map((option) => <option key={String(option)} value={option}>{option === "all" ? "All" : option}</option>)}
            </select>
            {/* axe reports the select's background as indeterminate ("bgOverlap")
                because this chevron is painted over it. Giving the chevron the
                same opaque surface token keeps the visual identical and makes
                the stack resolvable. */}
            <span aria-hidden="true" className="pointer-events-none absolute end-px top-px bottom-px flex items-center rounded-dd bg-dd-surface pe-2 ps-1 material-symbols-outlined text-[18px] leading-none text-dd-muted">expand_more</span>
          </span>
        </label>
      ) : null}
      {summary ? <span className="text-xs text-dd-muted">{summary}</span> : null}
      <div className="ms-auto flex items-center gap-1">
        <button type="button" aria-label="Previous page" disabled={clampedPage <= 1} onClick={() => onPage?.(clampedPage - 1)} className={NAV_BUTTON}>
          <span aria-hidden="true" className="material-symbols-outlined rtl:rotate-180 text-[18px] leading-none">chevron_left</span>
        </button>
        {getPageItems(clampedPage, safePageCount).map((item) => item.kind === "gap" ? (
          <span key={item.key} aria-hidden="true" className="flex size-11 items-center justify-center text-xs text-dd-subtle">…</span>
        ) : (
          <button key={item.n} type="button" aria-label={`Page ${item.n}`} aria-current={item.n === clampedPage ? "page" : undefined} onClick={() => onPage?.(item.n)} className={item.n === clampedPage ? PAGE_CURRENT : PAGE_GHOST}>{item.n}</button>
        ))}
        <button type="button" aria-label="Next page" disabled={clampedPage >= safePageCount} onClick={() => onPage?.(clampedPage + 1)} className={NAV_BUTTON}>
          <span aria-hidden="true" className="material-symbols-outlined rtl:rotate-180 text-[18px] leading-none">chevron_right</span>
        </button>
      </div>
    </nav>
  );
}
