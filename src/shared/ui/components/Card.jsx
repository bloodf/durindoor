/**
 * Durin DS — Card (surface container).
 *
 * Compound surface: `Card` is the bordered `rounded-dd-lg` shell; compose it
 * with `CardHeader` / `CardContent` / `CardFooter` for structured layouts
 * (pass `padding={false}` on `Card` so the sub-parts own the spacing), or use
 * `Card` alone with its default `p-5` padding for simple content.
 *
 * Styling uses only Durin DS token utilities (`bg-dd-surface`,
 * `border-dd-border`, `bg-dd-accent-soft`, …) so cards flip with the
 * Storybook "Theme" toolbar (dark "Moria stone" / light "Parchment").
 * All class names are complete literal strings: Tailwind v4 scans source
 * text, so conditional branches are written as full class literals.
 */

/** Bordered surface shell. `padding` toggles the default `p-5`; `hover` adds a subtle border highlight for clickable/linked cards. */
export function Card({ padding = true, hover = false, className = "", children, ...props }) {
  return (
    <div
      className={[
        "rounded-dd-lg border border-dd-border bg-dd-surface",
        padding ? "p-5" : "",
        hover ? "transition-colors hover:border-dd-border-subtle" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Card heading row: optional gold icon tile, title + subtitle stack, and
 * right-aligned `actions`. Separated from the content below by a subtle
 * bottom border — pair with `Card padding={false}`.
 */
export function CardHeader({ icon, title, subtitle, actions, className = "" }) {
  return (
    <div
      className={[
        "flex items-center gap-3 border-b border-dd-border-subtle px-5 py-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
            {icon}
          </span>
        </span>
      ) : null}
      {title || subtitle ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title ? <span className="truncate text-sm font-semibold text-dd-text">{title}</span> : null}
          {subtitle ? <span className="truncate text-xs text-dd-muted">{subtitle}</span> : null}
        </div>
      ) : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/** Padded body region for composed cards. */
export function CardContent({ className = "", children, ...props }) {
  return (
    <div className={["p-5", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

/** Footer strip for actions/meta, separated by a subtle top border. */
export function CardFooter({ className = "", children, ...props }) {
  return (
    <div
      className={["flex items-center gap-2 border-t border-dd-border-subtle px-5 py-3", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
