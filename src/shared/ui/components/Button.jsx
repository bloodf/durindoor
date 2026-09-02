/**
 * Durin DS — Button.
 *
 * Gold (`dd-accent`) is the only interactive accent and appears only on
 * `variant="primary"`; `variant="danger"` red is semantic-destructive only,
 * never decorative. Every color class resolves through `var(--dd-*)`, so the
 * button follows the Storybook "Theme" toggle (dark "Moria stone" / light
 * "Parchment") with no per-theme code.
 *
 * All class names are full literal strings on purpose: Tailwind v4 scans
 * source text, and interpolated class fragments would generate no CSS.
 */

const VARIANTS = {
  primary: "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
  secondary:
    "bg-dd-surface-2 border border-dd-border text-dd-text hover:bg-dd-surface-3",
  ghost: "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text",
  danger: "bg-dd-danger text-dd-on-danger hover:brightness-110",
};

const SIZES = {
  md: "h-9 px-3.5 text-[13px] font-medium",
  sm: "h-7 px-2.5 text-xs font-medium",
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
 * @param {"primary"|"secondary"|"ghost"|"danger"} [props.variant] Visual style; "primary" is the single gold accent action, "danger" is destructive only.
 * @param {"sm"|"md"} [props.size] md = 36px tall, sm = 28px tall.
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
  children,
  className = "",
  type = "button",
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
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
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
