import { useRef, useState, useEffect } from "react";

const PRESETS = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "15d", label: "15D" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
  { value: "all", label: "All" },
];

const PRESET_LABELS = {
  "1d": "Last day",
  "7d": "Last 7 days",
  "15d": "Last 15 days",
  "1m": "Last month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
  all: "All time",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMATTER.format(date);
}

/** Returns a compact, human-readable label for a preset or custom date range. */
export function rangeLabel(value) {
  if (value?.preset !== "custom") {
    return PRESET_LABELS[value?.preset] ?? "Date range";
  }
  if (!value.from || !value.to) return "Custom range";
  if (value.from === value.to) return formatDate(value.from);
  return `${formatDate(value.from)} – ${formatDate(value.to)}`;
}

/**
 * Durin DS — RangeSelector.
 *
 * Controlled date-range preset picker. Preset changes emit `{ preset }`;
 * custom ranges emit `{ preset: "custom", from, to }` only after validation.
 * The custom date editor closes on Apply, Cancel, Escape, or outside pointer.
 */
export default function RangeSelector({
  value,
  onChange,
  size = "md",
  className,
}) {
  const rootRef = useRef(null);
  const customButtonRef = useRef(null);
  const [open, setOpen] = useState(() => value?.preset === "custom");
  const [from, setFrom] = useState(() => (value?.preset === "custom" ? value.from ?? "" : ""));
  const [to, setTo] = useState(() => (value?.preset === "custom" ? value.to ?? "" : ""));

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        customButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const choosePreset = (preset) => {
    setOpen(false);
    onChange?.({ preset });
  };

  const openCustom = () => {
    setFrom(value?.preset === "custom" ? value.from ?? "" : "");
    setTo(value?.preset === "custom" ? value.to ?? "" : "");
    setOpen(true);
  };

  const closeCustom = () => {
    setOpen(false);
    customButtonRef.current?.focus();
  };

  const applyCustom = () => {
    if (!from || !to || from > to) return;
    onChange?.({ preset: "custom", from, to });
    closeCustom();
  };

  const segmentSize = size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]";
  const customSize = size === "sm" ? "h-6 gap-1 px-2.5 text-xs" : "h-7 gap-1.5 px-3 text-[13px]";
  const canApply = Boolean(from && to && from <= to);

  return (
    <div ref={rootRef} className={className ? `relative inline-flex ${className}` : "relative inline-flex"}>
      <div
        role="group"
        aria-label="Date range"
        className="inline-flex items-center gap-0.5 rounded-dd border border-dd-border bg-dd-surface-2 p-0.5"
      >
        {PRESETS.map((preset) => {
          const selected = value?.preset === preset.value;
          const segmentClassName = [
            "inline-flex cursor-pointer items-center justify-center rounded-dd font-medium outline-none transition-colors focus-visible:shadow-dd-focus",
            segmentSize,
            selected
              ? "bg-dd-surface text-dd-text shadow-sm"
              : "text-dd-muted hover:text-dd-text",
          ].join(" ");

          return (
            <button
              key={preset.value}
              type="button"
              aria-pressed={selected}
              onClick={() => choosePreset(preset.value)}
              className={segmentClassName}
            >
              {preset.label}
            </button>
          );
        })}

        <button
          ref={customButtonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-pressed={value?.preset === "custom"}
          onClick={openCustom}
          className={[
            "inline-flex cursor-pointer items-center justify-center rounded-dd font-medium outline-none transition-colors focus-visible:shadow-dd-focus",
            customSize,
            value?.preset === "custom"
              ? "bg-dd-accent-soft text-dd-accent"
              : "text-dd-muted hover:text-dd-text",
          ].join(" ")}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
            date_range
          </span>
          Custom
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Custom date range"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-dd border border-dd-border bg-dd-surface p-3 shadow-dd-elevated"
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-dd-muted">
              From
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
                className="h-8 min-w-0 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none focus-visible:shadow-dd-focus"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-dd-muted">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                className="h-8 min-w-0 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none focus-visible:shadow-dd-focus"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={closeCustom}
              className="h-7 rounded-dd px-2.5 text-xs font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canApply}
              onClick={applyCustom}
              className="h-7 rounded-dd bg-dd-accent px-2.5 text-xs font-medium text-dd-on-accent outline-none hover:bg-dd-accent-hover focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
