import { forwardRef, useId } from "react";

import Field, { useFieldContext } from "./Field.jsx";

/**
 * Durin DS — Textarea.
 *
 * Multi-line native input with same Field behaviour as Input. Field error/hint
 * ids are shared with `aria-describedby` on the real `<textarea>`; caller
 * descriptions are merged. The ref forwards to the native textarea. Vertically
 * resizable, `min-h-[96px]`; both size variants retain a 44px minimum target.
 */
const Textarea = forwardRef(function Textarea(
  {
    label,
    hint,
    error,
    size = "md",
    required = false,
    disabled = false,
    className,
    id,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const messageId = `${textareaId}-${error ? "error" : "hint"}`;
  const createsField = Boolean(label || hint || error);
  const outerField = useFieldContext();
  const fieldDescribedBy = createsField
    ? error || hint
      ? messageId
      : undefined
    : outerField?.describedBy;
  const callerDescribedBy = rest["aria-describedby"];
  const mergedDescribedBy = [...new Set([fieldDescribedBy, callerDescribedBy].filter(Boolean))]
    .join(" ") || undefined;
  const ariaInvalid = Boolean(error) || outerField?.invalid || rest["aria-invalid"] || undefined;

  const textareaClassName = [
    "min-h-[96px] w-full resize-y rounded-dd border border-dd-border bg-dd-surface text-dd-text outline-none transition-colors placeholder:text-dd-subtle",
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
      ref={ref}
      id={textareaId}
      required={required}
      disabled={disabled}
      className={textareaClassName}
      {...rest}
      aria-invalid={ariaInvalid}
      aria-describedby={mergedDescribedBy}
    />
  );

  if (createsField) {
    return (
      <Field
        label={label}
        hint={hint}
        error={error}
        required={required}
        htmlFor={textareaId}
        hintId={hint ? messageId : undefined}
        errorId={error ? messageId : undefined}
      >
        {control}
      </Field>
    );
  }
  return control;
});

export default Textarea;
