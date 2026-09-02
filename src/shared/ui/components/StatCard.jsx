/**
 * Durin DS — StatCard
 *
 * Compact metric card for dashboards: uppercase muted label, a large tabular
 * value, an optional trend delta row, and an optional hint line. `tone`
 * colors ONLY the value — gold (`accent`) marks an interactive/brand metric,
 * the status tones stay strictly semantic (success/warning/danger), per the
 * Durin DS design language. The optional `icon` stays neutral (`dd-subtle`)
 * so it never reads as a status signal. Token-backed utilities only.
 *
 * @param {object} props
 * @param {string} [props.icon] Material Symbols ligature name (neutral, top-right).
 * @param {React.ReactNode} props.label Uppercase 11px muted label.
 * @param {React.ReactNode} props.value Metric value (`text-2xl font-semibold dd-tnum`).
 * @param {"default"|"accent"|"success"|"warning"|"danger"} [props.tone="default"]
 *   Color applied to the value only.
 * @param {{ value: React.ReactNode, tone: "success"|"danger" }} [props.delta]
 *   Optional small trend row; the arrow glyph is derived from `delta.tone`.
 * @param {React.ReactNode} [props.hint] Footnote line (`text-xs text-dd-subtle`).
 */
const VALUE_TONE = {
  default: "text-dd-text",
  accent: "text-dd-accent",
  success: "text-dd-success",
  warning: "text-dd-warning",
  danger: "text-dd-danger",
};

const DELTA_TONE = {
  success: "text-dd-success",
  danger: "text-dd-danger",
};

const DELTA_ICON = {
  success: "trending_up",
  danger: "trending_down",
};

export default function StatCard({ icon, label, value, tone = "default", delta, hint }) {
  const valueTone = VALUE_TONE[tone] ?? VALUE_TONE.default;
  const deltaTone = delta ? (DELTA_TONE[delta.tone] ?? "text-dd-muted") : null;
  const deltaIcon = delta ? (DELTA_ICON[delta.tone] ?? "trending_flat") : null;

  return (
    <div className="flex flex-col gap-1 rounded-dd-lg border border-dd-border bg-dd-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-dd-muted">
          {label}
        </span>
        {icon ? (
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none text-dd-subtle">
            {icon}
          </span>
        ) : null}
      </div>
      <span className={`dd-tnum text-2xl font-semibold ${valueTone}`}>{value}</span>
      {delta ? (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${deltaTone}`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">
            {deltaIcon}
          </span>
          <span className="dd-tnum">{delta.value}</span>
        </span>
      ) : null}
      {hint ? <span className="text-xs text-dd-subtle">{hint}</span> : null}
    </div>
  );
}
