/**
 * Durin DS — IconButton.
 *
 * Icon-only action control for toolbars and dense rows. `label` is required
 * because it is the button's only accessible name (aria-label); the glyph
 * itself is aria-hidden. Colors resolve through `var(--dd-*)` utilities and
 * flip with the Storybook "Theme" toggle.
 *
 * All class names are full literal strings on purpose: Tailwind v4 scans
 * source text, and interpolated class fragments would generate no CSS.
 */

const VARIANTS = {
  ghost: "text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text",
  secondary:
    "bg-dd-surface-2 border border-dd-border text-dd-text hover:bg-dd-surface-3",
};

/* md = 32px square, sm = 26px square. */
const SIZES = {
  md: "h-8 w-8",
  sm: "h-[26px] w-[26px]",
};

/* Standalone icon buttons use 16–18px glyphs. */
const ICON_SIZES = {
  md: "text-[18px]",
  sm: "text-[16px]",
};

/**
 * @param {object} props
 * @param {string} props.icon Material Symbols ligature name (required).
 * @param {string} props.label Accessible name, applied as aria-label (required).
 * @param {"ghost"|"secondary"} [props.variant] "ghost" for toolbars, "secondary" when the action needs a visible boundary.
 * @param {"sm"|"md"} [props.size] md = 32px square, sm = 26px square.
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] Appended last so callers can override spacing.
 */
export default function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  disabled = false,
  className = "",
  type = "button",
  ...rest
}) {
  const resolvedSize = SIZES[size] ? size : "md";
  const classes = [
    "inline-flex items-center justify-center rounded-dd outline-none transition-colors focus-visible:shadow-dd-focus disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant] ?? VARIANTS.ghost,
    SIZES[resolvedSize],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      aria-label={label}
      disabled={disabled}
      className={classes}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined leading-none ${ICON_SIZES[resolvedSize]}`}
      >
        {icon}
      </span>
    </button>
  );
}
