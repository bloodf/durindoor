"use client";

import { cn } from "@/shared/utils/cn";

/**
 * Lightweight themed date-range picker built from two native `<input type="date">`
 * fields. No calendar dependency; the browser's native picker provides
 * keyboard/screen-reader accessibility and locale formatting for free.
 *
 * Controlled component: parent owns `startDate`/`endDate` (YYYY-MM-DD strings,
 * or "" when unset) and is notified via `onChange({ startDate, endDate })`.
 *
 * @param {Object} props
 * @param {string} props.startDate  - ISO date (YYYY-MM-DD) for the range start, or "".
 * @param {string} props.endDate    - ISO date (YYYY-MM-DD) for the range end, or "".
 * @param {(value: { startDate: string, endDate: string }) => void} props.onChange
 *        Called with the updated `{ startDate, endDate }` whenever either input changes.
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.className]
 */
export default function DateRangePicker({
  startDate = "",
  endDate = "",
  onChange,
  disabled = false,
  className,
}) {
  const inputClass = cn(
    "w-full py-2 px-3 text-sm text-text-main bg-surface-2 rounded-[10px]",
    "border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
    "transition-all duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed",
    "text-[16px] sm:text-sm",
  );

  const handleChange = (which) => (e) => {
    if (!onChange) return;
    const value = e.target.value || "";
    if (which === "start") onChange({ startDate: value, endDate });
    else onChange({ startDate, endDate: value });
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Range start date</span>
        <input
          type="date"
          value={startDate}
          max={endDate || undefined}
          onChange={handleChange("start")}
          disabled={disabled}
          className={inputClass}
          style={{ colorScheme: "auto" }}
        />
      </label>
      <span className="text-text-muted text-sm" aria-hidden="true">–</span>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Range end date</span>
        <input
          type="date"
          value={endDate}
          min={startDate || undefined}
          onChange={handleChange("end")}
          disabled={disabled}
          className={inputClass}
          style={{ colorScheme: "auto" }}
        />
      </label>
    </div>
  );
}
