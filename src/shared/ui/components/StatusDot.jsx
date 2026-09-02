/**
 * Durin DS — StatusDot (live status indicator).
 *
 * 8px colored dot for provider/connection/job states, optionally with a
 * muted text label beside it. `pulse` adds a subtle animated ring (a
 * 50%-alpha border of the same tone on `animate-pulse`) for live/running
 * states only — static states stay calm. Tones map to the semantic
 * `--dd-success/-warning/-danger/-info` tokens; `neutral` uses
 * `--dd-subtle`. All utilities resolve through `var(--dd-*)` and follow the
 * "Theme" toolbar toggle. Class names are complete literal strings so the
 * Tailwind v4 source scan generates them.
 */

const DOT_CLASSES = {
  success: "bg-dd-success",
  warning: "bg-dd-warning",
  danger: "bg-dd-danger",
  info: "bg-dd-info",
  neutral: "bg-dd-subtle",
};

const RING_CLASSES = {
  success: "border-dd-success/50",
  warning: "border-dd-warning/50",
  danger: "border-dd-danger/50",
  info: "border-dd-info/50",
  neutral: "border-dd-border-subtle/50",
};

/**
 * @param {object} props
 * @param {"success"|"warning"|"danger"|"info"|"neutral"} [props.tone]
 * @param {boolean} [props.pulse] Animated ring for live/running states.
 * @param {string} [props.label] Optional text beside the dot.
 */
export function StatusDot({ tone = "neutral", pulse = false, label, className = "", ...props }) {
  const dot = DOT_CLASSES[tone] || DOT_CLASSES.neutral;
  const ring = RING_CLASSES[tone] || RING_CLASSES.neutral;
  return (
    <span className={["inline-flex items-center gap-1.5", className].filter(Boolean).join(" ")} {...props}>
      <span className="relative inline-flex size-2 shrink-0">
        {pulse ? (
          <span
            aria-hidden="true"
            className={`absolute -inset-1 animate-pulse rounded-full border ${ring}`}
          />
        ) : null}
        <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      </span>
      {label ? <span className="text-xs text-dd-muted">{label}</span> : null}
    </span>
  );
}
