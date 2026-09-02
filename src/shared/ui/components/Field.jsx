import { Children, cloneElement, isValidElement, useId } from "react";

/**
 * Durin DS — Field.
 *
 * Layout wrapper that stacks an optional label, the control (`children`), and
 * a hint or error line. Used internally by Input/Textarea and exported so any
 * control (Select, Checkbox groups, custom controls) can get the same chrome:
 *
 *   <Field label="Provider" hint="Determines request translation.">
 *     <Select … />
 *   </Field>
 *
 * Accessibility: when `children` is a single element, the field injects
 * `aria-invalid` and `aria-describedby` (pointing at the rendered error/hint)
 * into it. Durin DS controls forward unknown props onto their native control
 * element, so the attributes land where screen readers need them. Error
 * styling cascades the same way — controls style themselves with
 * `aria-invalid:border-dd-danger` (or `peer-aria-invalid:` for Checkbox), so
 * wrapping any control in an errored Field turns it red automatically. The
 * error line also carries `role="alert"` so it is announced when it appears.
 *
 * Multi-node children (e.g. a row of checkboxes) render untouched.
 *
 * All classes are complete literal strings: Tailwind v4 scans source text and
 * would not generate interpolated class names.
 */
export default function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  className,
  children,
}) {
  const autoId = useId();
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;

  const items = Children.toArray(children);
  let control = children;
  if (items.length === 1 && isValidElement(items[0])) {
    const describedBy = error ? errorId : hint ? hintId : undefined;
    control = cloneElement(items[0], {
      "aria-invalid": error ? true : items[0].props["aria-invalid"],
      "aria-describedby": describedBy ?? items[0].props["aria-describedby"],
    });
  }

  return (
    <div
      className={
        className ? `flex flex-col gap-1.5 ${className}` : "flex flex-col gap-1.5"
      }
    >
      {label ? (
        <label htmlFor={htmlFor} className="text-xs font-medium text-dd-muted">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-dd-danger">
              {" *"}
            </span>
          ) : null}
        </label>
      ) : null}
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-dd-danger">
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
