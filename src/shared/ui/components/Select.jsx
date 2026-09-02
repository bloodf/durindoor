import { useEffect, useId, useRef, useState } from "react";

/**
 * Durin DS — Select.
 *
 * Custom dropdown (deliberately NOT a native `<select>` so the face, dropdown
 * surface and option rows can follow the Durin DS tokens in both themes). The
 * trigger matches the `Input` face with a trailing `expand_more` icon that
 * rotates while open; the dropdown is an elevated absolute overlay, opening
 * below the trigger by default or above it with `placement="top"` (footer
 * toolbars).
 *
 * Behaviour:
 * - Closes on Esc (focus returns to the trigger), on outside pointer down,
 *   and on selection.
 * - Selected option rows use `bg-dd-accent-soft text-dd-accent` with a
 *   trailing `check`; rows hover `bg-dd-surface-2`.
 * - Listbox semantics: `aria-haspopup="listbox"` / `aria-expanded` on the
 *   trigger, `role="listbox"` / `role="option" aria-selected` in the overlay.
 * - Wrap in `Field` for label/hint/error chrome — injected `aria-invalid`
 *   turns the trigger border red via the `aria-invalid:` utilities below.
 *
 * Props: `options` = [{ value, label, icon?, hint? }], `value`,
 * `onChange(value)`, `placeholder`, `size` ("md" | "sm"), `disabled`,
 * `placement` ("bottom" | "top"), `className` (merged on the root).
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
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxId = useId();

  const selected = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (option) => {
    onChange?.(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const triggerClassName = [
    "flex w-full items-center justify-between gap-2 border border-dd-border bg-dd-surface text-left text-dd-text rounded-dd outline-none transition-colors",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-[13px]",
    "hover:border-dd-border-subtle focus-visible:border-dd-accent focus-visible:shadow-dd-focus",
    "aria-invalid:border-dd-danger aria-invalid:hover:border-dd-danger",
    "disabled:cursor-not-allowed disabled:opacity-60",
  ].join(" ");

  const dropdownClassName =
    placement === "top"
      ? "absolute inset-x-0 bottom-full z-50 mb-1 max-h-64 w-full overflow-y-auto border border-dd-border bg-dd-surface py-1 rounded-dd shadow-dd-elevated"
      : "absolute inset-x-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto border border-dd-border bg-dd-surface py-1 rounded-dd shadow-dd-elevated";

  return (
    <div
      ref={rootRef}
      className={className ? `relative w-full ${className}` : "relative w-full"}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={triggerClassName}
        {...rest}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            {selected.icon ? (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[18px] leading-none text-dd-muted"
              >
                {selected.icon}
              </span>
            ) : null}
            <span className="truncate">{selected.label}</span>
          </span>
        ) : (
          <span className="truncate text-dd-subtle">{placeholder}</span>
        )}
        <span
          aria-hidden="true"
          className={`material-symbols-outlined shrink-0 text-[18px] leading-none text-dd-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      {open ? (
        <ul role="listbox" id={listboxId} className={dropdownClassName}>
          {options.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-dd-subtle">No options</li>
          ) : (
            options.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onClick={() => choose(option)}
                    className={
                      isSelected
                        ? "flex w-full items-center gap-2 bg-dd-accent-soft px-3 py-2 text-left text-[13px] text-dd-accent"
                        : "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-dd-text hover:bg-dd-surface-2"
                    }
                  >
                    {option.icon ? (
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined shrink-0 text-[18px] leading-none"
                      >
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="truncate text-xs text-dd-subtle">
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <span
                        aria-hidden="true"
                        className="material-symbols-outlined shrink-0 text-[18px] leading-none"
                      >
                        check
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
