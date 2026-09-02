import { useId } from "react";

/**
 * Durin DS — Toggle (switch).
 *
 * Controlled boolean switch on a real `<button role="switch">`. Gold
 * (`dd-accent`) is reserved for the ON track — the only interactive accent
 * in the system; the OFF track is a neutral `dd-surface-3` well. The knob is
 * `dd-on-accent` when ON and a raised `dd-surface` chip with a hairline
 * border when OFF, so both states read in dark "Moria stone" and light
 * "Parchment".
 *
 * Sizes follow the density scale: md = 36×20px track, sm = 30×17px track.
 * With `label`/`description` the component renders a settings-style row —
 * texts left, switch right — with the label wired via `htmlFor`, so clicking
 * the text toggles the control.
 *
 * Class names are complete literals in source (arrays joined at render):
 * Tailwind v4 scans file text for candidates, so interpolated class names
 * would never generate CSS. Every color resolves through `var(--dd-*)` and
 * flips with the Storybook "Theme" toolbar toggle.
 */

const TRACK_SIZE = {
  md: "h-5 w-9", // 36 × 20 px
  sm: "h-[17px] w-[30px]", // 30 × 17 px
};

const KNOB_SIZE = {
  md: "h-4 w-4", // 16 px — 2 px inset on a 20 px track
  sm: "h-[13px] w-[13px]", // 13 px — 2 px inset on a 17 px track
};

const KNOB_ON_OFFSET = {
  md: "translate-x-4", // 16 px travel: 36 − 2 − 2 − 16
  sm: "translate-x-[13px]", // 13 px travel: 30 − 2 − 2 − 13
};

export default function Toggle({
  checked = false,
  onChange,
  disabled = false,
  size = "md",
  label,
  description,
  ...rest
}) {
  const id = useId();
  const hasText = Boolean(label || description);

  const trackClassName = [
    "relative inline-flex shrink-0 rounded-full outline-none transition-colors duration-200 motion-reduce:transition-none",
    "focus-visible:shadow-dd-focus",
    TRACK_SIZE[size] ?? TRACK_SIZE.md,
    checked ? "bg-dd-accent" : "bg-dd-surface-3",
    // In row mode the whole row is dimmed instead (see below), so the switch
    // only dims itself when standalone.
    disabled
      ? hasText
        ? "cursor-not-allowed"
        : "cursor-not-allowed opacity-60"
      : "cursor-pointer",
  ].join(" ");

  const knobClassName = [
    "absolute left-0.5 top-0.5 rounded-full border shadow-sm transition-all duration-200 motion-reduce:transition-none",
    KNOB_SIZE[size] ?? KNOB_SIZE.md,
    checked
      ? [KNOB_ON_OFFSET[size] ?? KNOB_ON_OFFSET.md, "bg-dd-on-accent border-transparent"].join(" ")
      : "translate-x-0 border-dd-border bg-dd-surface",
  ].join(" ");

  const switchButton = (
    <button
      {...rest}
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={trackClassName}
    >
      <span aria-hidden="true" className={knobClassName} />
    </button>
  );

  if (!hasText) {
    return switchButton;
  }

  return (
    <div
      className={
        disabled
          ? "flex items-center justify-between gap-4 opacity-60"
          : "flex items-center justify-between gap-4"
      }
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {label ? (
          <label htmlFor={id} className="text-[13px] font-medium text-dd-text">
            {label}
          </label>
        ) : null}
        {description ? <p className="text-xs text-dd-muted">{description}</p> : null}
      </div>
      {switchButton}
    </div>
  );
}
