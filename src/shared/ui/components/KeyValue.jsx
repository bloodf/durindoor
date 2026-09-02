/**
 * Durin DS — KeyValue
 *
 * Dense metadata row for detail panels and list footers (e.g. an API-key meta
 * row: created date, expiry, models, usage, daily limit). Entries render as
 * `inline-flex` 12px muted pairs separated by subtle vertical dividers and
 * wrap as a group on narrow widths. Values marked `mono` use the mono stack
 * with tabular figures in `text-dd-text` so numbers pop out of the muted row.
 * Rendered as a semantic `<dl>` (div-wrapped dt/dd pairs are valid HTML).
 *
 * @param {object} props
 * @param {Array<{ icon?: string, label: React.ReactNode, value: React.ReactNode, mono?: boolean }>} props.items
 *   Meta entries. `icon` is a Material Symbols ligature name; `mono` styles
 *   the value with `font-mono dd-tnum text-dd-text`.
 */
import { Fragment } from "react";

export default function KeyValue({ items = [] }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {items.map((item, index) => (
        <Fragment key={item.label ?? index}>
          {index > 0 ? (
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-dd-border-subtle" />
          ) : null}
          <div className="inline-flex items-center gap-1.5 text-xs text-dd-muted">
            {item.icon ? (
              <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">
                {item.icon}
              </span>
            ) : null}
            <dt>{item.label}</dt>
            <dd className={item.mono ? "font-mono dd-tnum text-dd-text" : undefined}>
              {item.value}
            </dd>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}
