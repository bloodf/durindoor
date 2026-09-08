"use client";

import { cn } from "@/shared/utils/cn";

/**
 * Controlled calendar range. Native date controls preserve immediate legacy
 * `{ startDate, endDate }` change events and browser locale accessibility.
 */
export default function DateRangePicker({
  startDate = "",
  endDate = "",
  onChange,
  disabled = false,
  className,
}) {
  const inputClass = "min-h-11 w-full min-w-0 rounded-dd border border-dd-border bg-dd-surface px-3 text-[16px] text-dd-text outline-none transition-colors focus:border-dd-accent focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-60 sm:text-[13px]";
  const handleChange = (which) => (event) => {
    const value = event.target.value || "";
    onChange?.(which === "start" ? { startDate: value, endDate } : { startDate, endDate: value });
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <label className="min-w-0 flex-1">
        <span className="sr-only">Range start date</span>
        <input type="date" value={startDate} max={endDate || undefined} onChange={handleChange("start")} disabled={disabled} className={inputClass} />
      </label>
      <span aria-hidden="true" className="text-dd-muted">–</span>
      <label className="min-w-0 flex-1">
        <span className="sr-only">Range end date</span>
        <input type="date" value={endDate} min={startDate || undefined} onChange={handleChange("end")} disabled={disabled} className={inputClass} />
      </label>
    </div>
  );
}
