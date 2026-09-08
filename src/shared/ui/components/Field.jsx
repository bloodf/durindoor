import { Children, cloneElement, createContext, isValidElement, useContext, useId } from "react";

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
 * Accessibility, two paths:
 * - Self-wrapping controls (Input/Textarea passing their own `label`/`hint`/
 *   `error` straight through) compute their own hint/error id and pass it in
 *   via `hintId`/`errorId` so the id they put on the native control's
 *   `aria-describedby` always matches the `<p id=…>` Field renders — no
 *   dependency on render/hook ordering between the two components.
 * - Bare children nested inside an externally-authored `<Field>` (e.g.
 *   `<Field label="…"><Input /></Field>`) read the error/hint state from
 *   `FieldContext`, published below.
 * - Any other single child (Select, custom controls) still gets the ARIA
 *   attributes cloned on directly, matching the original Field contract.
 *
 * The error line carries `role="alert"` so it is announced when it appears.
 * All classes are complete literal strings: Tailwind v4 scans source text and
 * would not generate interpolated class names.
 */
const FieldContext = createContext(null);

/** Read the nearest enclosing Field's error/hint state (invalid, describedBy). */
export function useFieldContext() {
  return useContext(FieldContext);
}

export default function Field({
  label,
  hint,
  error,
  required = false,
  group = false,
  htmlFor,
  className,
  hintId: hintIdProp,
  errorId: errorIdProp,
  children,
}) {
  const autoId = useId();
  const hintId = hintIdProp ?? `${autoId}-hint`;
  const errorId = errorIdProp ?? `${autoId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const items = Children.toArray(children);
  let control = children;
  let controlId = htmlFor;
  if (!group && items.length === 1 && isValidElement(items[0])) {
    const childProps = items[0].props;
    controlId ??= childProps.id ?? autoId;
    const accessibilityProps = {
      "aria-invalid": error ? true : childProps["aria-invalid"],
      "aria-describedby": [...new Set([childProps["aria-describedby"], describedBy].filter(Boolean).join(" ").split(/\s+/))].filter(Boolean).join(" ") || undefined,
    };
    if (!htmlFor) accessibilityProps.id = controlId;
    control = cloneElement(items[0], accessibilityProps);
  }
  const Wrapper = group ? "fieldset" : "div";
  const Label = group ? "legend" : "label";

  return (
    <FieldContext.Provider value={{ invalid: Boolean(error), describedBy }}>
      <Wrapper
        className={
          className ? `flex flex-col gap-1.5 ${className}` : "flex flex-col gap-1.5"
        }
        aria-describedby={group ? describedBy : undefined}
      >
        {label ? (
          <Label htmlFor={group ? undefined : controlId} className="text-xs font-medium text-dd-muted">
            {label}
            {required ? (
              <span aria-hidden="true" className="text-dd-danger">
                {" *"}
              </span>
            ) : null}
          </Label>
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
      </Wrapper>
    </FieldContext.Provider>
  );
}
