import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBrowser } from "../../utils/typeChecks.js";

/**
 * Durin DS — Select.
 *
 * Custom single-select listbox. `options` accepts `{ value, label, icon?,
 * hint?, disabled? }`; `onChange` receives selected value. The trigger keeps
 * forwarded native attributes such as `name`, `aria-invalid`, and
 * `aria-describedby`.
 *
 * Keyboard: Arrow/Home/End and typeahead move active option; Enter/Space
 * select it; Escape cancels and returns focus to trigger; Tab exits normally.
 * Selection (`aria-selected`) and active navigation (`aria-activedescendant`)
 * remain distinct. The fixed portal avoids clipping in scroll containers and
 * dialogs while preserving RTL positioning.
 */
export default function Select({
  options = [],
  value,
  onChange,
  placeholder = "Select…",
  size = "md",
  disabled = false,
  placement = "bottom",
  className,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);
  const [portalHost, setPortalHost] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);
  const typeaheadRef = useRef({ value: "", timeout: null });
  const listboxId = useId();
  const optionId = useCallback((index) => `${listboxId}-option-${index}`, [listboxId]);
  const selected = options.find((option) => option.value === value) ?? null;

  const enabledIndices = options.reduce((indices, option, index) => {
    if (!option.disabled) indices.push(index);
    return indices;
  }, []);
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportHeight = window.innerHeight;
    const below = viewportHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const openAbove = placement === "top" ? above >= 120 || above > below : below < 120 && above > below;
    setPosition({
      left: Math.max(8, rect.left),
      top: openAbove ? undefined : rect.bottom + 4,
      bottom: openAbove ? viewportHeight - rect.top + 4 : undefined,
      width: Math.min(rect.width, window.innerWidth - Math.max(8, rect.left) - 8),
      maxHeight: Math.max(44, Math.min(256, openAbove ? above : below)),
    });
  }, [placement]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (option) => {
    if (option.disabled) return;
    onChange?.(option.value);
    close(true);
  };

  const openAt = (index = selectedIndex >= 0 ? selectedIndex : enabledIndices[0]) => {
    if (disabled) return;
    setActiveIndex(index ?? -1);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !isBrowser()) return undefined;
    setPortalHost(triggerRef.current?.closest("dialog") ?? document.body);
    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);



  useEffect(() => {
    if (!open || !isBrowser()) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !listboxRef.current?.contains(event.target)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => () => clearTimeout(typeaheadRef.current.timeout), []);

  useEffect(() => {
    if (!open || activeIndex < 0 || !isBrowser()) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, optionId]);

  const moveActive = (direction) => {
    if (!enabledIndices.length) return;
    const current = enabledIndices.indexOf(activeIndex);
    const next = current < 0
      ? (direction > 0 ? 0 : enabledIndices.length - 1)
      : (current + direction + enabledIndices.length) % enabledIndices.length;
    setActiveIndex(enabledIndices[next]);
  };

  const typeahead = (key) => {
    if (key.length !== 1 || /\s/.test(key) || !enabledIndices.length) return;
    clearTimeout(typeaheadRef.current.timeout);
    typeaheadRef.current.value += key.toLocaleLowerCase();
    const query = typeaheadRef.current.value;
    const start = Math.max(0, enabledIndices.indexOf(activeIndex));
    const ordered = [...enabledIndices.slice(start + 1), ...enabledIndices.slice(0, start + 1)];
    const match = ordered.find((index) => options[index].label.toLocaleLowerCase().startsWith(query));
    if (match !== undefined) setActiveIndex(match);
    typeaheadRef.current.timeout = setTimeout(() => {
      typeaheadRef.current.value = "";
    }, 500);
  };

  const onKeyDown = (event) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        const initial = event.key === "ArrowUp" || event.key === "End"
          ? enabledIndices.at(-1)
          : event.key === "Home" ? enabledIndices[0] : undefined;
        openAt(initial);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(enabledIndices[0] ?? -1);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(enabledIndices.at(-1) ?? -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0) choose(options[activeIndex]);
    } else if (event.key === "Tab") {
      close();
    } else {
      typeahead(event.key);
    }
  };

  const triggerClassName = [
    "flex min-h-11 w-full items-center justify-between gap-2 border border-dd-border bg-dd-surface px-3 text-left text-dd-text rounded-dd outline-none transition-colors",
    size === "sm" ? "text-xs" : "text-[13px]",
    "hover:border-dd-border-subtle focus-visible:border-dd-accent focus-visible:shadow-dd-focus",
    "aria-invalid:border-dd-danger aria-invalid:hover:border-dd-danger",
    "disabled:cursor-not-allowed disabled:opacity-60",
  ].join(" ");

  const listboxMounted = Boolean(open && position && portalHost);
  const listbox = open && position ? (
    <ul
      ref={listboxRef}
      role="listbox"
      id={listboxId}
      aria-label={rest["aria-label"]}
      className="fixed z-[70] overflow-y-auto rounded-dd border border-dd-border bg-dd-surface py-1 shadow-dd-elevated outline-none"
      style={position}
    >
      {options.length === 0 ? (
        <li className="min-h-11 px-3 py-3 text-[13px] text-dd-subtle">No options</li>
      ) : options.map((option, index) => {
        const isSelected = option.value === value;
        const isActive = index === activeIndex;
        return (
          <li
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={isSelected}
            aria-disabled={option.disabled || undefined}
            onMouseMove={() => !option.disabled && setActiveIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={[
              "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[13px] outline-none",
              option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-dd-surface-2",
              isSelected ? "bg-dd-accent-soft text-dd-accent" : "text-dd-text",
              isActive ? "ring-2 ring-inset ring-dd-accent" : "",
            ].join(" ")}
          >
            {option.icon ? <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] leading-none">{option.icon}</span> : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{option.label}</span>
              {option.hint ? <span className="truncate text-xs text-dd-subtle">{option.hint}</span> : null}
            </span>
            {isSelected ? <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[18px] leading-none">check</span> : null}
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div ref={rootRef} className={className ? `w-full ${className}` : "w-full"}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-autocomplete="none"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listboxMounted ? listboxId : undefined}
        aria-activedescendant={listboxMounted && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onClick={() => open ? close() : openAt()}
        onKeyDown={onKeyDown}
        className={triggerClassName}
        {...rest}
      >
        {selected ? <span className="flex min-w-0 items-center gap-2">{selected.icon ? <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none text-dd-muted">{selected.icon}</span> : null}<span className="truncate">{selected.label}</span></span> : <span className="truncate text-dd-subtle">{placeholder}</span>}
        <span aria-hidden="true" className={`material-symbols-outlined shrink-0 text-[18px] leading-none text-dd-muted transition-transform ${open ? "rotate-180" : ""}`}>expand_more</span>
      </button>
      {portalHost ? createPortal(listbox, portalHost) : null}
    </div>
  );
}
