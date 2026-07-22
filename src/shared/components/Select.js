"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Themed dropdown select. Drop-in replacement for a native `<select>`: it keeps
 * the same props (`label`, `options`, `value`, `onChange`, `placeholder`, …) and
 * calls `onChange` with a synthetic `{ target: { value } }` event so existing
 * callsites that read `e.target.value` keep working. Unlike a native `<select>`
 * (whose popup the OS renders with its own unstyleable chrome), this renders a
 * fully theme-controlled button + listbox panel with keyboard support.
 *
 * @param {object} props
 * @param {string} [props.label]
 * @param {{value:string,label:string,disabled?:boolean}[]} [props.options]
 * @param {string} [props.value]
 * @param {(e:{target:{value:string}})=>void} [props.onChange]
 * @param {string} [props.placeholder]
 * @param {string} [props.error]
 * @param {string} [props.hint]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.required]
 * @param {string} [props.className]     wrapper classes
 * @param {string} [props.selectClassName] trigger-button classes
 */
export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
  "aria-label": ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const labelId = useId();

  const selected = options.find((o) => o.value === value) || null;
  const displayLabel = selected ? selected.label : placeholder;

  const emit = (next) => {
    if (onChange) onChange({ target: { value: next } });
  };

  const choose = (option) => {
    if (option?.disabled) return;
    emit(option.value);
    setOpen(false);
  };

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // When opening, focus the currently-selected option.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setActiveIndex(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

  const moveActive = (dir) => {
    setActiveIndex((prev) => {
      let next = prev;
      for (let i = 0; i < options.length; i += 1) {
        next = (next + dir + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return prev;
    });
  };

  const onTriggerKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      moveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && activeIndex >= 0) choose(options[activeIndex]);
      else setOpen((o) => !o);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} ref={rootRef}>
      {label && (
        <span id={labelId} className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </span>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={label ? labelId : undefined}
          aria-label={!label ? ariaLabel : undefined}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "w-full flex items-center justify-between gap-2 py-2.5 px-3 text-sm text-left",
            "bg-surface-2 border border-transparent rounded-[10px]",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
            "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            "text-[16px] sm:text-sm",
            error && "ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/40 border-red-500/40",
            selectClassName
          )}
        >
          <span className={cn("truncate", !selected && "text-text-muted")}>{displayLabel}</span>
          <span className="material-symbols-outlined text-[20px] text-text-muted shrink-0">expand_more</span>
        </button>

        {open && (
          <ul
            ref={listRef}
            role="listbox"
            aria-labelledby={label ? labelId : undefined}
            className={cn(
              "absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-64 overflow-y-auto custom-scrollbar",
              "rounded-[10px] border border-border bg-bg shadow-lg p-1"
            )}
          >
            {options.length === 0 && (
              <li className="px-3 py-2 text-sm text-text-muted">{placeholder}</li>
            )}
            {options.map((option, idx) => {
              const isSelected = option.value === value;
              const isActive = idx === activeIndex;
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-[8px] cursor-pointer select-none",
                    option.disabled && "opacity-40 cursor-not-allowed",
                    isActive && !option.disabled && "bg-surface-2",
                    isSelected && "text-brand-500 font-medium"
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <span className="material-symbols-outlined text-[18px] shrink-0">check</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
