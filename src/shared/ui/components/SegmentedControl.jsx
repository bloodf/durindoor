import { useRef } from "react";

/**
 * Durin DS — SegmentedControl.
 *
 * Single-selection segmented control with radiogroup semantics: one option
 * is always "checked", arrow keys (and Home/End) move the selection, and a
 * roving tabindex keeps only the selected segment tabbable. The selected
 * segment is a raised `dd-surface` chip with a light `shadow-sm`; unselected
 * segments stay quiet (`dd-muted` → `dd-text` on hover). No gold here —
 * `dd-accent` is reserved for primary actions, links and focus rings.
 *
 * The md size totals 36px tall (28px segment + 2×2px padding + 2×1px
 * border), matching the md button height so both align in toolbars.
 *
 * Class names are complete literals in source: Tailwind v4 scans file text
 * for candidates, so interpolated class names would never generate CSS.
 */

const SEGMENT_SIZE = {
  md: "h-7 gap-1.5 px-3 text-[13px]",
  sm: "h-6 gap-1 px-2.5 text-xs",
};

const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  disabled = false,
  ...rest
}) {
  const containerRef = useRef(null);

  const selectOption = (option, index) => {
    if (disabled || option.disabled) return;
    onChange?.(option.value);
    // Move focus alongside the selection (radiogroup pattern). The buttons
    // already exist in the DOM, so a direct focus is enough.
    const buttons = containerRef.current?.querySelectorAll('[role="radio"]');
    buttons?.[index]?.focus();
  };

  const handleKeyDown = (event) => {
    if (!NAV_KEYS.includes(event.key)) return;
    event.preventDefault();

    const enabledIndexes = [];
    options.forEach((option, index) => {
      if (!option.disabled) enabledIndexes.push(index);
    });
    if (enabledIndexes.length === 0) return;

    const currentIndex = options.findIndex((option) => option.value === value);
    let nextIndex;
    if (event.key === "Home") {
      nextIndex = enabledIndexes[0];
    } else if (event.key === "End") {
      nextIndex = enabledIndexes[enabledIndexes.length - 1];
    } else {
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const position = enabledIndexes.indexOf(currentIndex);
      let nextPosition;
      if (position === -1) {
        nextPosition = direction === 1 ? 0 : enabledIndexes.length - 1;
      } else {
        nextPosition =
          (position + direction + enabledIndexes.length) % enabledIndexes.length;
      }
      nextIndex = enabledIndexes[nextPosition];
    }
    selectOption(options[nextIndex], nextIndex);
  };

  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);

  return (
    <div
      {...rest}
      ref={containerRef}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className="inline-flex items-center gap-0.5 rounded-dd border border-dd-border bg-dd-surface-2 p-0.5"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const optionDisabled = disabled || Boolean(option.disabled);
        // Roving tabindex: the selected segment is tabbable; if nothing is
        // selected, the first enabled segment takes over.
        const tabbable =
          !optionDisabled &&
          (selected || (selectedIndex === -1 && index === firstEnabledIndex));

        const segmentClassName = [
          "inline-flex items-center justify-center rounded-[6px] font-medium outline-none transition-colors focus-visible:shadow-dd-focus",
          SEGMENT_SIZE[size] ?? SEGMENT_SIZE.md,
          selected
            ? "bg-dd-surface text-dd-text shadow-sm"
            : "text-dd-muted enabled:hover:text-dd-text",
          optionDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        ].join(" ");

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={optionDisabled}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => selectOption(option, index)}
            className={segmentClassName}
          >
            {option.icon ? (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[18px] leading-none"
              >
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
