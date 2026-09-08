"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Durin DS — Toggle (production lane: shared-actions).
 *
 * Controlled boolean switch retaining `ariaLabel`, `className`, and `lg` in
 * addition to compact sizes. Emits a plain boolean to `onChange`. The native
 * `<button role="switch">` is wrapped in a 44px target while the visible
 * track stays compact (md ≈ 36 × 20, sm ≈ 30 × 17, lg ≈ 44 × 24).
 *
 * RTL parity: the knob uses `start-0.5` plus `ltr:translate-x-* rtl:-translate-x-*`
 * offsets so a checked switch travels toward the trailing edge in both reading
 * directions. Label/description create a settings row whose label is wired to
 * the switch via `htmlFor`. Motion pauses under reduced-motion preferences.
 */
const TRACK = {
  sm: "h-[17px] w-[30px]",
  md: "h-5 w-9",
  lg: "h-6 w-12",
};
const KNOB = {
  sm: "h-[13px] w-[13px]",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};
const KNOB_ON = {
  sm: "ltr:translate-x-[13px] rtl:-translate-x-[13px]",
  md: "ltr:translate-x-4 rtl:-translate-x-4",
  lg: "ltr:translate-x-6 rtl:-translate-x-6",
};

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
  ariaLabel,
  ...rest
}) {
  const autoId = useId();
  const switchId = rest.id ?? autoId;
  const descriptionId = description ? `${switchId}-description` : undefined;
  const callerDescribedBy = rest["aria-describedby"];
  const mergedDescribedBy =
    [...new Set([descriptionId, callerDescribedBy].filter(Boolean))].join(" ") || undefined;
  const hasText = Boolean(label || description);

  const trackClassName = cn(
    "relative inline-flex rounded-full transition-colors duration-200 motion-reduce:transition-none",
    TRACK[size] ?? TRACK.md,
    checked ? "bg-dd-accent" : "bg-dd-surface-3"
  );

  const knobClassName = cn(
    "absolute start-0.5 top-0.5 rounded-full border border-dd-border bg-dd-surface shadow-sm transition-transform duration-200 motion-reduce:transition-none",
    KNOB[size] ?? KNOB.md,
    checked && cn(KNOB_ON[size] ?? KNOB_ON.md, "border-transparent bg-dd-on-accent")
  );

  const switchButton = (
    <button
      {...rest}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? rest["aria-label"]}
      aria-describedby={mergedDescribedBy}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-dd outline-none focus-visible:shadow-dd-focus",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        !hasText && className
      )}
    >
      <span aria-hidden="true" className={trackClassName}>
        <span aria-hidden="true" className={knobClassName} />
      </span>
    </button>
  );

  if (!hasText) return switchButton;

  return (
    <div className={cn("flex items-center justify-between gap-4", disabled && "opacity-60", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {label && <label htmlFor={switchId} className="text-[13px] font-medium text-dd-text">{label}</label>}
        {description && <p id={descriptionId} className="text-xs text-dd-muted">{description}</p>}
      </div>
      {switchButton}
    </div>
  );
}
