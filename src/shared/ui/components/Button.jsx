/**
 * Durin DS — Button.
 *
 * Primary actions use emerald and danger is reserved for destructive actions.
 * Colors resolve only through Durin DS tokens so every theme keeps its
 * intended contrast.
 *
 * All class names are full literal strings on purpose: Tailwind v4 scans
 * source text, and interpolated class fragments would generate no CSS.
 */

const VARIANTS = {
  primary: "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
  secondary:
    "bg-dd-surface-2 border border-dd-border text-dd-text hover:bg-dd-surface-3",
  ghost: "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text",
  danger:
    "bg-dd-danger-action text-dd-on-danger hover:bg-dd-danger-action-hover",
};

/* Content remains dense while every interactive box is at least 44px square. */
const SIZES = {
  md: "min-h-11 min-w-11 px-3.5 text-[13px] font-medium",
  sm: "min-h-11 min-w-11 px-2.5 text-[13px] font-medium",
};

/**
 * Leading/trailing glyph. Always aria-hidden — the accessible name comes
 * from the button's visible text (or an aria-label passed via `...rest`).
 */
function ButtonIcon({ name, spin = false }) {
  return (
    <span
      aria-hidden="true"
      className={
        spin
          ? "material-symbols-outlined animate-spin text-[18px] leading-none"
          : "material-symbols-outlined text-[18px] leading-none"
      }
    >
      {name}
    </span>
  );
}

/**
 * @param {object} props
 * @param {"primary"|"secondary"|"ghost"|"danger"} [props.variant] Visual style; primary uses emerald and danger is destructive only.
 * @param {"sm"|"md"} [props.size] Both sizes keep a 44px pointer target; sm only reduces horizontal padding.
 * @param {string} [props.icon] Material Symbols ligature name, rendered before the label.
 * @param {string} [props.iconTrailing] Material Symbols ligature name, rendered after the label.
 * @param {boolean} [props.loading] Replaces the leading icon with a spinner and disables the button.
 * @param {boolean} [props.disabled]
 * @param {React.ReactNode} [props.children] Visible label.
 * @param {string} [props.className] Appended last so callers can override spacing/width.
 */
export default function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconTrailing,
  loading = false,
  disabled = false,
  type = "button",
  children,
  className = "",
  ...rest
}) {
  const classes = [
    "inline-flex items-center justify-center gap-1.5 rounded-dd outline-none transition-colors focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant] ?? VARIANTS.secondary,
    SIZES[size] ?? SIZES.md,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
    >
      {loading ? (
        <ButtonIcon name="progress_activity" spin />
      ) : icon ? (
        <ButtonIcon name={icon} />
      ) : null}
      {children}
      {iconTrailing ? <ButtonIcon name={iconTrailing} /> : null}
    </button>
  );
}
