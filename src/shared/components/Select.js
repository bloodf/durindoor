"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/utils/cn";
import { isUndefined } from "@/shared/utils/typeChecks";

/**
 * Durin DS — Select (production lane: shared-actions).
 *
 * Custom listbox retains this component's existing form wrapper API and emits
 * `onChange({ target: { value } })` for native-select-compatible consumers.
 * It also keeps caller classes (`className`, `selectClassName`), labels, hints,
 * errors, required marker, disabled options, and arbitrary trigger attributes.
 * A body portal prevents clipping inside dialogs and scroll panes.
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
  placement = "bottom",
  id,
  "aria-label": ariaLabel,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);
  const typeaheadRef = useRef({ value: "", timeout: null });
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const labelId = `${triggerId}-label`;
  const listboxId = `${triggerId}-listbox`;
  const hintId = `${triggerId}-hint`;
  const errorId = `${triggerId}-error`;
  const selected = options.find((option) => option.value === value) ?? null;
  const enabledIndices = options.reduce((indices, option, index) => {
    if (!option.disabled) indices.push(index);
    return indices;
  }, []);

  const emit = (next) => onChange?.({ target: { value: next } });
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const choose = (option) => {
    if (option?.disabled) return;
    emit(option.value);
    close(true);
  };
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const openAt = (index) => {
    if (disabled) return;
    const nextIndex = index ?? (selectedIndex >= 0 ? selectedIndex : enabledIndices[0] ?? -1);
    setActiveIndex(nextIndex);
    setOpen(true);
  };
  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: rect.left,
      width: rect.width,
      top: placement === "top" ? undefined : rect.bottom + 4,
      bottom: placement === "top" ? window.innerHeight - rect.top + 4 : undefined,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    setPortalHost(!isUndefined(globalThis.document) ? triggerRef.current?.closest("dialog") ?? globalThis.document.body : null);
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !listboxRef.current?.contains(event.target)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => () => clearTimeout(typeaheadRef.current.timeout), []);
  useEffect(() => {
    if (open && activeIndex >= 0) {
      listboxRef.current?.querySelectorAll('[role="option"]')[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  const moveActive = (direction) => {
    if (!enabledIndices.length) return;
    setActiveIndex((current) => {
      const currentPosition = enabledIndices.indexOf(current);
      const nextPosition = currentPosition < 0
        ? (direction > 0 ? 0 : enabledIndices.length - 1)
        : (currentPosition + direction + enabledIndices.length) % enabledIndices.length;
      return enabledIndices[nextPosition];
    });
  };
  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openAt(event.key === "ArrowDown" ? enabledIndices[0] : enabledIndices.at(-1));
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openAt(event.key === "Home" ? enabledIndices[0] : enabledIndices.at(-1));
      else setActiveIndex(event.key === "Home" ? enabledIndices[0] : enabledIndices.at(-1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && activeIndex >= 0) choose(options[activeIndex]);
      else openAt();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const nextValue = `${typeaheadRef.current.value}${event.key}`.toLocaleLowerCase();
      typeaheadRef.current.value = nextValue;
      clearTimeout(typeaheadRef.current.timeout);
      typeaheadRef.current.timeout = setTimeout(() => { typeaheadRef.current.value = ""; }, 500);
      const match = options.findIndex((option) => !option.disabled && option.label?.toLocaleLowerCase().startsWith(nextValue));
      if (match >= 0) {
        event.preventDefault();
        if (!open) openAt(match);
        else setActiveIndex(match);
      }
    }
  };

  const describedBy = [...new Set([error ? errorId : hint ? hintId : undefined, rest["aria-describedby"]].filter(Boolean))].join(" ") || undefined;
  const listboxContent = open && position ? (
    <ul
      ref={listboxRef}
      id={listboxId}
      role="listbox"
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : ariaLabel}
      className="fixed z-[70] max-h-64 overflow-y-auto rounded-dd border border-dd-border bg-dd-surface p-1 shadow-dd-elevated"
      style={position}
    >
      {options.length === 0 ? (
        <li className="flex min-h-11 items-center px-3 py-2 text-[13px] text-dd-subtle">{placeholder}</li>
      ) : options.map((option, index) => {
        const selectedOption = option.value === value;
        const active = index === activeIndex;
        return (
          <li
            key={option.value}
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={selectedOption}
            aria-disabled={option.disabled || undefined}
            onMouseEnter={() => !option.disabled && setActiveIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-dd px-3 py-2 text-[13px] text-dd-text outline-none",
              active && !option.disabled && "bg-dd-surface-2",
              selectedOption && "font-medium text-dd-accent",
              option.disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {option.icon && <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] leading-none">{option.icon}</span>}
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.hint && <span className="truncate text-xs text-dd-subtle">{option.hint}</span>}
              </span>
            </span>
            {selectedOption && <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] leading-none">check</span>}
          </li>
        );
      })}
    </ul>
  ) : null;
  // When a Select lives inside a native <dialog> the browser top layer hides
  // nodes portaled to document.body. Rehost the listbox inside the closest
  // <dialog> so the panel stays visible above the modal scrim.
  const listbox = listboxContent && portalHost ? createPortal(listboxContent, portalHost) : null;


  return (
    <div ref={rootRef} className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label id={labelId} htmlFor={triggerId} className="text-xs font-medium text-dd-muted">
          {label}
          {required && <span aria-hidden="true" className="ml-1 text-dd-danger">*</span>}
        </label>
      )}
      <button
        {...rest}
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : rest["aria-invalid"]}
        aria-describedby={describedBy}
        onClick={() => open ? close() : openAt()}
        onKeyDown={onKeyDown}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-dd border border-dd-border bg-dd-surface px-3 text-left text-[16px] text-dd-text outline-none transition-colors sm:text-[13px]",
          "hover:border-dd-border-subtle focus:border-dd-accent focus-visible:shadow-dd-focus",
          "aria-invalid:border-dd-danger aria-invalid:hover:border-dd-danger aria-invalid:focus:border-dd-danger",
          "disabled:cursor-not-allowed disabled:opacity-60",
          selectClassName
        )}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            {selected.icon && <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none text-dd-muted">{selected.icon}</span>}
            <span className="truncate">{selected.label}</span>
          </span>
        ) : <span className="truncate text-dd-subtle">{placeholder}</span>}
        <span aria-hidden="true" className={`material-symbols-outlined shrink-0 text-[18px] leading-none text-dd-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>expand_more</span>
      </button>
      {listbox}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-dd-danger">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">error</span>
          {error}
        </p>
      ) : hint ? <p id={hintId} className="text-xs text-dd-subtle">{hint}</p> : null}
    </div>
  );
}
