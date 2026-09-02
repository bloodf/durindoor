import { useId } from "react";

import Field from "./Field.jsx";

/**
 * Durin DS — Input.
 *
 * Text input with an optional leading Material Symbols icon. When `label`,
 * `hint` or `error` is provided the control wraps itself in `Field`, which
 * renders the chrome and injects `aria-invalid` / `aria-describedby`; the red
 * error border is driven by the `aria-invalid:` utilities below, so it also
 * lights up when the Input sits inside an errored `Field` manually.
 *
 * All remaining props (`type`, `value`, `placeholder`, `autoComplete`, …) are
 * spread onto the underlying `<input>`.
 *
 * Sizes: "md" (h-9, 13px text — default) | "sm" (h-7, 12px text).
 */
export default function Input({
  label,
  hint,
  error,
  icon,
  size = "md",
  required = false,
  disabled = false,
  className,
  id,
  ...rest
}) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const inputClassName = [
    "w-full border border-dd-border bg-dd-surface text-dd-text rounded-dd outline-none transition-colors placeholder:text-dd-subtle",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3 text-[13px]",
    icon ? (size === "sm" ? "pl-8" : "pl-9") : null,
    "hover:border-dd-border-subtle focus:border-dd-accent focus:shadow-dd-focus",
    "aria-invalid:border-dd-danger aria-invalid:hover:border-dd-danger aria-invalid:focus:border-dd-danger",
    "disabled:cursor-not-allowed disabled:opacity-60",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const control = (
    <div className="relative">
      {icon ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 flex items-center ${
            size === "sm" ? "pl-2.5" : "pl-3"
          }`}
        >
          <span className="material-symbols-outlined text-[18px] leading-none text-dd-subtle">
            {icon}
          </span>
        </span>
      ) : null}
      <input
        id={inputId}
        type="text"
        required={required}
        disabled={disabled}
        className={inputClassName}
        {...rest}
      />
    </div>
  );

  if (label || hint || error) {
    return (
      <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
        {control}
      </Field>
    );
  }
  return control;
}
