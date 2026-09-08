"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Durin DS — Input (production lane: shared-actions).
 *
 * Keeps existing label/hint/error wrapper and `inputClassName` escape hatch;
 * every remaining prop reaches the native input. Error state has an announced
 * message and token-backed border. Input text remains 16px on narrow screens
 * to avoid iOS focus zoom, while desktop keeps compact dashboard density.
 */
export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  id,
  ...props
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const messageId = error ? errorId : hint ? hintId : undefined;
  const describedBy = [...new Set([messageId, props["aria-describedby"]].filter(Boolean))].join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-dd-muted">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-1 text-dd-danger">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
          >
            <span className="material-symbols-outlined text-[18px] leading-none text-dd-subtle">
              {icon}
            </span>
          </span>
        )}
        <input
          {...props}
          id={inputId}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={describedBy}
          className={cn(
            "min-h-11 w-full rounded-dd border border-dd-border bg-dd-surface px-3 text-[16px] text-dd-text outline-none transition-colors placeholder:text-dd-subtle sm:text-[13px]",
            "hover:border-dd-border-subtle focus:border-dd-accent focus-visible:shadow-dd-focus",
            "aria-invalid:border-dd-danger aria-invalid:hover:border-dd-danger aria-invalid:focus:border-dd-danger",
            "disabled:cursor-not-allowed disabled:opacity-60",
            icon && "pl-9",
            inputClassName
          )}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-dd-danger">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">
            error
          </span>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-dd-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
