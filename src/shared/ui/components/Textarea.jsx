import { useId } from "react";

import Field from "./Field.jsx";

/**
 * Durin DS — Textarea.
 *
 * Multi-line text input; same API as `Input` minus the leading `icon`. Wraps
 * itself in `Field` when `label` / `hint` / `error` is provided; the error
 * border is driven by `aria-invalid:` utilities injected by Field (see
 * `Field.jsx`). Vertically resizable, `min-h-[96px]`.
 *
 * All remaining props (`value`, `rows`, `placeholder`, …) are spread onto the
 * underlying `<textarea>`.
 *
 * Sizes: "md" (13px text — default) | "sm" (12px text).
 */
export default function Textarea({
  label,
  hint,
  error,
  size = "md",
  required = false,
  disabled = false,
  className,
  id,
  ...rest
}) {
  const autoId = useId();
  const textareaId = id ?? autoId;

  const textareaClassName = [
    "min-h-[96px] w-full resize-y border border-dd-border bg-dd-surface text-dd-text rounded-dd outline-none transition-colors placeholder:text-dd-subtle",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-[13px]",
    "hover:border-dd-border-subtle focus:border-dd-accent focus:shadow-dd-focus",
    "aria-invalid:border-dd-danger aria-invalid:hover:border-dd-danger aria-invalid:focus:border-dd-danger",
    "disabled:cursor-not-allowed disabled:opacity-60",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const control = (
    <textarea
      id={textareaId}
      required={required}
      disabled={disabled}
      className={textareaClassName}
      {...rest}
    />
  );

  if (label || hint || error) {
    return (
      <Field
        label={label}
        hint={hint}
        error={error}
        required={required}
        htmlFor={textareaId}
      >
        {control}
      </Field>
    );
  }
  return control;
}
