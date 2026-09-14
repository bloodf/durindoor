/**
 * Durin DS — Card surface primitives.
 *
 * `padding` is the single card-density contract: `true` uses the default
 * `md` density, `false` removes padding, and named densities map to
 * `none` (0), `xs` (12px), `sm` (16px), `md` (20px), or `lg` (24px).
 * Compound cards normally use `padding={false}` so `CardHeader`,
 * `CardContent`, and `CardFooter` own aligned 20px horizontal spacing.
 */

const CARD_PADDING_CLASSES = {
  none: "p-0",
  xs: "p-3",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

function cardPaddingClass(padding) {
  if (padding === false || padding === "none") return CARD_PADDING_CLASSES.none;
  if (padding === true || padding == null) return CARD_PADDING_CLASSES.md;
  return CARD_PADDING_CLASSES[padding] ?? CARD_PADDING_CLASSES.md;
}

/** Bordered surface shell with canonical density and optional hover affordance. */
export function Card({ padding = true, hover = false, className = "", children, ...props }) {
  return (
    <div
      className={[
        "min-w-0 rounded-dd-lg border border-dd-border bg-dd-surface",
        cardPaddingClass(padding),
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
 * Structured heading with optional icon, title stack, and wrapping actions.
 * At narrow widths actions flow below the title instead of clipping content.
 */
export function CardHeader({ icon, title, subtitle, actions, className = "", ...props }) {
  return (
    <div
      className={[
        "flex min-w-0 flex-wrap items-center gap-3 border-b border-dd-border-subtle px-5 py-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-accent-soft text-dd-accent">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
            {icon}
          </span>
        </span>
      ) : null}
      {title || subtitle ? (
        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
          {title ? <span className="break-words text-sm font-semibold text-dd-text">{title}</span> : null}
          {subtitle ? <span className="break-words text-xs text-dd-muted">{subtitle}</span> : null}
        </div>
      ) : null}
      {actions ? (
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Body region: anywhere wrapping also reduces nested tables' intrinsic widths. */
export function CardContent({ className = "", children, ...props }) {
  return (
    <div className={["min-w-0 [overflow-wrap:anywhere] p-5", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

/** Wrapping footer with canonical 20px horizontal compound-card spacing. */
export function CardFooter({ className = "", children, ...props }) {
  return (
    <div
      className={[
        "flex min-w-0 flex-wrap items-center gap-2 border-t border-dd-border-subtle px-5 py-3",
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
