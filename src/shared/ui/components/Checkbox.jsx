import { forwardRef, useId } from "react";

import { useFieldContext } from "./Field.jsx";

/**
 * Durin DS — Checkbox.
 *
 * Custom 18px check box driven by a visually-hidden native
 * `<input type="checkbox">` (kept as a `peer` sibling), so keyboard focus,
 * screen-reader semantics and form participation come from the real control
 * while the visual box follows the Durin DS tokens: gold `bg-dd-accent` with
 * a `text-dd-on-accent` `check` ligature when checked, `shadow-dd-focus`
 * ring on keyboard focus. The whole row (box + label/hint) is wrapped in a
 * `<label>`, so clicking the text toggles the control. The row has a 44px
 * minimum target so the click area is comfortable.
 *
 * Props: `label`, `hint`, `checked`, `onChange(nextChecked: boolean)`,
 * `disabled`, `className` (merged on the root label). Remaining props
 * (`name`, `value`, aria-*, …) spread onto the hidden `<input>`; that is
 * also where an enclosing Field's `aria-invalid` / `aria-describedby` land
 * (via context) so the box border goes red (`peer-aria-invalid:`) and the
 * hint/error is announced. A caller's own `aria-describedby` is merged with
 * Field's id (deduped). The ref forwards to the native input.
 */
const Checkbox = forwardRef(function Checkbox(
  { label, hint, checked = false, onChange, disabled = false, className, ...rest },
  ref,
) {
  const fallbackId = useId();
  const field = useFieldContext();
  const callerDescribedBy = rest["aria-describedby"];
  const mergedDescribedBy =
    [...new Set([field?.describedBy, callerDescribedBy].filter(Boolean))].join(" ") || undefined;
  const ariaInvalid = field?.invalid || rest["aria-invalid"];
  const inputId = rest.id ?? fallbackId;

  return (
    <label
      htmlFor={inputId}
      className={[
        "group relative flex min-h-11 min-w-11 items-start gap-2.5",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="peer absolute left-0 top-0 size-11 cursor-inherit opacity-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        {...rest}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={mergedDescribedBy}
      />
      <span
        aria-hidden="true"
        className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border border-dd-border bg-dd-surface transition-colors peer-checked:border-dd-accent peer-checked:bg-dd-accent peer-focus-visible:shadow-dd-focus peer-aria-invalid:border-dd-danger"
      >
        {checked ? (
          <span className="material-symbols-outlined text-[16px] leading-none text-dd-on-accent">
            check
          </span>
        ) : null}
      </span>
      {label || hint ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label ? <span className="text-[13px] text-dd-text">{label}</span> : null}
          {hint ? <span className="text-xs text-dd-subtle">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
});

export default Checkbox;
