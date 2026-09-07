import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

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

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function rangeError(from, to) {
  if (!from && !to) return "";
  if (!from || !to) return "Enter both a start and end date.";
  if (!isDate(from) || !isDate(to)) return "Enter valid calendar dates.";
  if (from > to) return "Start date must be on or before end date.";
  return "";
}

function isFocusable(element) {
  if (!(element instanceof HTMLElement) || element.isContentEditable) return true;
  if (element.tabIndex >= 0) return true;
  return ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) && !element.hasAttribute("disabled");
}

/** Returns a compact, human-readable label for a preset or custom date range. */
export function rangeLabel(value) {
  if (value?.preset !== "custom") return PRESET_LABELS[value?.preset] ?? "Date range";
  if (!value.from || !value.to) return "Custom range";
  if (value.from === value.to) return formatDate(value.from);
  return `${formatDate(value.from)} – ${formatDate(value.to)}`;
}

/**
 * Controlled date-range picker. Date strings remain ISO calendar dates; callers
 * retain conversion to page-specific Date/query formats. Custom values emit only
 * after valid Apply. This is a non-modal dialog: focus enters it on open, but Tab
 * remains free to continue through page controls.
 * `presets` may supply caller-owned period IDs without changing query semantics.
 */
export default function RangeSelector({ value, onChange, presets = PRESETS, size = "md", className }) {
  const rootRef = useRef(null);
  const customButtonRef = useRef(null);
  const fromInputRef = useRef(null);
  const dialogRef = useRef(null);
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [popoverStyle, setPopoverStyle] = useState(null);
  const error = rangeError(from, to);
  const canApply = Boolean(from && to && !error);

  const restoreTriggerFocus = () => customButtonRef.current?.focus();
  const closeCustom = () => {
    setOpen(false);
    restoreTriggerFocus();
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const positionPopover = () => {
      const trigger = customButtonRef.current?.getBoundingClientRect();
      const dialog = dialogRef.current;
      if (!trigger || !dialog) return;
      const margin = 16;
      const width = Math.min(dialog.offsetWidth || 320, window.innerWidth - margin * 2);
      const height = dialog.offsetHeight || 220;
      const left = Math.max(margin, Math.min(trigger.right - width, window.innerWidth - width - margin));
      const below = trigger.bottom + 4;
      const top = below + height <= window.innerHeight - margin
        ? below
        : Math.max(margin, trigger.top - height - 4);
      setPopoverStyle({ left, top, width });
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    fromInputRef.current?.focus();
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        if (!isFocusable(event.target)) restoreTriggerFocus();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCustom();
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
    if (open) return closeCustom();
    setFrom(value?.preset === "custom" ? value.from ?? "" : "");
    setTo(value?.preset === "custom" ? value.to ?? "" : "");
    setOpen(true);
  };
  const applyCustom = () => {
    if (!canApply) return;
    onChange?.({ preset: "custom", from, to });
    closeCustom();
  };

  const segmentSize = size === "sm" ? "min-h-11 min-w-11 px-2 text-xs" : "min-h-11 min-w-11 px-3 text-[13px]";
  const customSize = size === "sm" ? "min-h-11 min-w-11 gap-1 px-2 text-xs" : "min-h-11 min-w-11 gap-1.5 px-3 text-[13px]";
  const controlClassName = "inline-flex cursor-pointer items-center justify-center rounded-dd font-medium outline-none transition-colors focus-visible:shadow-dd-focus";

  return (
    <div ref={rootRef} className={className ? `relative inline-flex max-w-full ${className}` : "relative inline-flex max-w-full"}>
      <div role="group" aria-label="Date range" className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-dd border border-dd-border bg-dd-surface-2 p-0.5">
        {presets.map((preset) => {
          const selected = value?.preset === preset.value;
          return <button key={preset.value} type="button" aria-pressed={selected} onClick={() => choosePreset(preset.value)} className={`${controlClassName} ${segmentSize} ${selected ? "bg-dd-surface text-dd-text shadow-sm" : "text-dd-muted hover:text-dd-text"}`}>{preset.label}</button>;
        })}
        <button ref={customButtonRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-pressed={value?.preset === "custom"} onClick={openCustom} className={`${controlClassName} ${customSize} ${value?.preset === "custom" ? "bg-dd-accent-soft text-dd-text" : "text-dd-muted hover:text-dd-text"}`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">date_range</span>
          Custom
        </button>
      </div>
      {open ? <div ref={dialogRef} role="dialog" aria-label="Custom date range" aria-describedby={error ? errorId : undefined} style={popoverStyle ?? undefined} className="fixed z-50 w-80 max-w-[calc(100vw-2rem)] rounded-dd border border-dd-border bg-dd-surface p-3 shadow-dd-elevated">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-dd-muted">From<input ref={fromInputRef} type="date" value={from} max={to || undefined} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => setFrom(event.target.value)} className="min-h-11 min-w-0 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none focus-visible:shadow-dd-focus" /></label>
          <label className="flex flex-col gap-1 text-xs font-medium text-dd-muted">To<input type="date" value={to} min={from || undefined} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => setTo(event.target.value)} className="min-h-11 min-w-0 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none focus-visible:shadow-dd-focus" /></label>
        </div>
        {error ? <p id={errorId} role="alert" className="mt-2 text-xs text-dd-danger">{error}</p> : null}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={closeCustom} className="min-h-11 min-w-11 rounded-dd px-3 text-xs font-medium text-dd-muted outline-none hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus">Cancel</button>
          <button type="button" disabled={!canApply} onClick={applyCustom} className="min-h-11 min-w-11 rounded-dd bg-dd-accent px-3 text-xs font-medium text-dd-on-accent outline-none hover:bg-dd-accent-hover focus-visible:shadow-dd-focus disabled:cursor-not-allowed disabled:opacity-50">Apply</button>
        </div>
      </div> : null}
    </div>
  );
}
