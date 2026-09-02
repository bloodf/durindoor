/**
 * Durin DS — Badge (status/category label).
 *
 * Small pill for metadata and semantic status. Gold (`accent`) marks
 * interactive/featured info; green/amber/red/blue are strictly semantic
 * (success/warning/danger/info). Colored tones use a 10% alpha tint of the
 * matching `--dd-*` token (Tailwind v4 `color-mix` opacity modifier), accent
 * uses the dedicated `--dd-accent-soft` token, and neutral is a bordered
 * `dd-surface-2` chip — every utility resolves through `var(--dd-*)`, so
 * badges follow the "Theme" toolbar toggle.
 *
 * Class names are complete literal strings (Tailwind v4 scans source text);
 * tone/size variants are lookup maps of full literals.
 */

const TONE_CLASSES = {
  neutral: "border border-dd-border bg-dd-surface-2 text-dd-muted",
  accent: "bg-dd-accent-soft text-dd-accent",
  success: "bg-dd-success/10 text-dd-success",
  warning: "bg-dd-warning/10 text-dd-warning",
  danger: "bg-dd-danger/10 text-dd-danger",
  info: "bg-dd-info/10 text-dd-info",
};

const SIZE_CLASSES = {
  sm: "gap-1 px-1.5 py-0.5 text-[11px]",
  md: "gap-1 px-2 py-0.5 text-xs",
};

const ICON_CLASSES = {
  sm: "text-[12px]",
  md: "text-[14px]",
};

/**
 * @param {object} props
 * @param {"neutral"|"accent"|"success"|"warning"|"danger"|"info"} [props.tone]
 * @param {"sm"|"md"} [props.size]
 * @param {string} [props.icon] Material Symbols ligature name.
 */
export function Badge({ tone = "neutral", size = "md", icon, className = "", children, ...props }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        TONE_CLASSES[tone] || TONE_CLASSES.neutral,
        SIZE_CLASSES[size] || SIZE_CLASSES.md,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={`material-symbols-outlined leading-none ${ICON_CLASSES[size] || ICON_CLASSES.md}`}
        >
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
