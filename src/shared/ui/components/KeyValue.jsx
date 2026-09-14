/**
 * Durin DS — KeyValue
 *
 * Dense metadata row for detail panels and list footers (e.g. an API-key meta
 * row: created date, expiry, models, usage, daily limit). Entries render as
 * wrapping 12px muted pairs separated by subtle vertical dividers. Long labels
 * and values break inside the available width instead of widening the page.
 * Do not combine `break-words` with `overflow-wrap:anywhere`: its later utility
 * would override the min-content-safe wrapping rule.
 * Values marked `mono` use the mono stack with tabular figures in `text-dd-text`.
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
    <dl className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {items.map((item, index) => (
        <Fragment key={item.label ?? index}>
          {index > 0 ? (
            <span aria-hidden="true" className="h-3 w-px shrink-0 bg-dd-border-subtle" />
          ) : null}
          <div className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs text-dd-muted">
            {item.icon ? (
              <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">
                {item.icon}
              </span>
            ) : null}
            <dt className="[overflow-wrap:anywhere]">{item.label}</dt>
            <dd className={`min-w-0 [overflow-wrap:anywhere] ${item.mono ? "font-mono dd-tnum text-dd-text" : ""}`}>
              {item.value}
            </dd>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}
