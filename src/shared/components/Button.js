"use client";

/**
 * Durin DS — Button (production lane: shared-actions).
 *
 * Backwards-compatible surface: variant ∈ {primary, secondary, outline, ghost,
 * danger, success}, size ∈ {sm, md, lg}, leading/trailing Material Symbols
 * icon, `loading` (spinner + disabled), `disabled`, `fullWidth`. Every color
 * resolves through Durin DS tokens so both palettes keep the intended contrast:
 * primary and legacy success use emerald action tokens, secondary is neutral,
 * outline is transparent, and danger stays destructive-only.
 *
 * Class names are full literal strings in source — Tailwind v4 scans source
 * text and would not generate interpolated class names. Rest props are
 * forwarded so callers can attach `aria-label`, `type`, `onClick`, etc.
 */

const VARIANTS = {
  primary:
    "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
  secondary:
    "bg-dd-surface-2 border border-dd-border text-dd-text hover:bg-dd-surface-3",
  outline:
    "bg-transparent border border-dd-border text-dd-text hover:border-dd-accent hover:text-dd-text",
  ghost:
    "bg-transparent text-dd-muted hover:bg-dd-surface-2 hover:text-dd-text",
  danger:
    "bg-dd-danger-action text-dd-on-danger hover:bg-dd-danger-action-hover",
  // No success-action token exists in Durin DS (--dd-success is a status-text
  // token, not a solid action background); success reuses the emerald
  // primary-action palette so it stays token-backed and legible in both
  // themes. Flagging as a caveat rather than a lossy hex/opacity coercion.
  success:
    "bg-dd-accent text-dd-on-accent hover:bg-dd-accent-hover",
};

const SIZES = {
  sm: "min-h-11 min-w-11 px-3 text-xs rounded-dd",
  md: "min-h-11 min-w-11 px-4 text-sm rounded-dd",
  lg: "min-h-11 min-w-11 px-6 text-sm rounded-dd",
};

function ButtonIcon({ name, spin = false, size = "md" }) {
  const dim = size === "sm" ? "text-[16px]" : "text-[18px]";
  return (
    <span
      aria-hidden="true"
      className={
        spin
          ? `material-symbols-outlined ${dim} leading-none animate-spin motion-reduce:animate-none`
          : `material-symbols-outlined ${dim} leading-none`
      }
    >
      {name}
    </span>
  );
}

/**
 * @param {object} props
 * @param {"primary"|"secondary"|"outline"|"ghost"|"danger"|"success"} [props.variant]
 * @param {"sm"|"md"|"lg"} [props.size]
 * @param {string} [props.icon] Leading Material Symbols ligature.
 * @param {string} [props.iconRight] Trailing Material Symbols ligature.
 * @param {boolean} [props.loading] Replaces leading icon with spinner; disables button.
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.fullWidth] Stretch to 100% width.
 * @param {string} [props.className] Appended last so callers can override spacing/width.
 */
export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = "button",
  className,
  ...rest
}) {
  const variantClass = VARIANTS[variant] ?? VARIANTS.primary;
  const sizeClass = SIZES[size] ?? SIZES.md;

  const classes = [
    "inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-150 ease-out cursor-pointer outline-none focus-visible:shadow-dd-focus",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
    "active:scale-[0.97] motion-reduce:active:scale-100",
    variantClass,
    sizeClass,
    fullWidth ? "w-full" : null,
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
        <ButtonIcon name="progress_activity" spin size={size} />
      ) : icon ? (
        <ButtonIcon name={icon} size={size} />
      ) : null}
      {children}
      {iconRight && !loading ? <ButtonIcon name={iconRight} size={size} /> : null}
    </button>
  );
}
