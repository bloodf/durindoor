import { useId } from "react";

/**
 * Durin DS — Toggle (switch).
 *
 * Controlled boolean switch on a real `<button role="switch">`. Its 44px
 * button target centers the dense visual track (md 36×20px, sm 30×17px), so
 * accessibility does not change visual density. Gold (`dd-accent`) is the ON
 * track; OFF is a neutral `dd-surface-3` well. Motion stops when requested
 * (`motion-reduce:transition-none`).
 *
 * A label targets the button via `htmlFor`; an optional description is wired
 * through `aria-describedby`, merged with any caller-supplied
 * `aria-describedby`. All colors resolve through Durin DS token utilities.
 */
const TRACK_SIZE = {
  md: "h-5 w-9",
  sm: "h-[17px] w-[30px]",
};

const KNOB_SIZE = {
  md: "h-4 w-4",
  sm: "h-[13px] w-[13px]",
};

const KNOB_ON_OFFSET = {
  md: "translate-x-4",
  sm: "translate-x-[13px]",
};

export default function Toggle({
  checked = false,
  onChange,
  disabled = false,
  size = "md",
  label,
  description,
  id,
  ...rest
}) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const descriptionId = description ? `${switchId}-description` : undefined;
  const callerDescribedBy = rest["aria-describedby"];
  const mergedDescribedBy =
    [...new Set([descriptionId, callerDescribedBy].filter(Boolean))].join(" ") || undefined;
  const hasText = Boolean(label || description);

  const trackClassName = [
    "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
    TRACK_SIZE[size] ?? TRACK_SIZE.md,
    checked ? "bg-dd-accent" : "bg-dd-surface-3",
    disabled ? "cursor-not-allowed" : "cursor-pointer",
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
      id={switchId}
      aria-checked={checked}
      aria-describedby={mergedDescribedBy}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full outline-none focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className={trackClassName}>
        <span aria-hidden="true" className={knobClassName} />
      </span>
    </button>
  );

  if (!hasText) return switchButton;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        {label ? (
          <label htmlFor={switchId} className="text-[13px] font-medium text-dd-text">
            {label}
          </label>
        ) : null}
        {description ? (
          <p id={descriptionId} className="text-xs text-dd-muted">
            {description}
          </p>
        ) : null}
      </div>
      {switchButton}
    </div>
  );
}
