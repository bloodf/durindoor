"use client";

import { useRef } from "react";
import { cn } from "@/shared/utils/cn";
import { isBrowser } from "@/shared/utils/typeChecks";

/**
 * Durin DS — SegmentedControl (production lane: shared-actions).
 *
 * Retains options/value/onChange/size/className API, plus private option icon
 * support. Radio semantics, roving tab stop, Arrow/Home/End movement, disabled
 * option skipping, 44px targets, and reduced-motion behavior are all contained
 * in the production component.
 */
const SIZES = {
  sm: "min-h-11 min-w-11 gap-1 px-2.5 text-xs",
  md: "min-h-11 min-w-11 gap-1.5 px-3 text-[13px]",
  lg: "min-h-11 min-w-11 gap-2 px-4 text-sm",
};

const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
  disabled = false,
  ...rest
}) {
  const containerRef = useRef(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);

  const selectOption = (option, index) => {
    if (disabled || option.disabled || option.value === value) return;
    onChange?.(option.value);
    containerRef.current?.querySelectorAll('[role="radio"]')?.[index]?.focus();
  };

  const handleKeyDown = (event) => {
    if (disabled || !NAV_KEYS.includes(event.key)) return;
    event.preventDefault();
    const enabledIndexes = options.reduce((indexes, option, index) => {
      if (!option.disabled) indexes.push(index);
      return indexes;
    }, []);
    if (!enabledIndexes.length) return;
    const isRtl = isBrowser() && getComputedStyle(containerRef.current).direction === "rtl";
    let nextIndex;
    if (event.key === "Home") nextIndex = enabledIndexes[0];
    else if (event.key === "End") nextIndex = enabledIndexes.at(-1);
    else {
      // Horizontal arrows flip in RTL so ArrowLeft visually retreats even
      // when the segment order is reversed; Up/Down keep their native mapping.
      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const direction = horizontal
        ? (isRtl ? -1 : 1) * (event.key === "ArrowLeft" ? -1 : 1)
        : (event.key === "ArrowUp" ? -1 : 1);
      const selectedPosition = enabledIndexes.indexOf(selectedIndex);
      const nextPosition = selectedPosition < 0
        ? (direction > 0 ? 0 : enabledIndexes.length - 1)
        : (selectedPosition + direction + enabledIndexes.length) % enabledIndexes.length;
      nextIndex = enabledIndexes[nextPosition];
    }
    selectOption(options[nextIndex], nextIndex);
  };

  return (
    <div
      {...rest}
      ref={containerRef}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-dd border border-dd-border bg-dd-surface-2 p-0.5",
        className
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const optionDisabled = disabled || Boolean(option.disabled);
        const tabbable = !optionDisabled && (selected || (selectedIndex === -1 && index === firstEnabledIndex));
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={optionDisabled}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => selectOption(option, index)}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-dd font-medium outline-none transition-colors motion-reduce:transition-none focus-visible:shadow-dd-focus",
              SIZES[size] ?? SIZES.md,
              selected ? "bg-dd-surface text-dd-text shadow-sm" : "text-dd-muted enabled:hover:text-dd-text",
              optionDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            )}
          >
            {option.icon && <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">{option.icon}</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
