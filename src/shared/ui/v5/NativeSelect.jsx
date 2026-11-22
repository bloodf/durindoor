import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import { Children, Fragment, forwardRef, isValidElement, useRef, useState } from "react";
import Select from "@/shared/ui/components/Select.jsx";

export function nativeOptions(children, group = "", groupDisabled = false) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) return nativeOptions(child.props.children, group, groupDisabled);
    if (child.type === "optgroup") return nativeOptions(child.props.children, child.props.label, groupDisabled || !!child.props.disabled);
    if (child.type !== "option") return [];
    const label = Children.toArray(child.props.children).join("");
    return [{ value: String(child.props.value ?? label), label, hint: group || undefined, disabled: groupDisabled || !!child.props.disabled }];
  });
}

/** V5 native-select adapter. Existing handlers keep the DOM event
 * convention and forms keep a native successful control/required constraint.
 * The original select remains unchanged when the production switch is off.
 */
export const V5NativeSelect = forwardRef(function V5NativeSelect({ children, value, defaultValue, onChange, ...props }, forwardedRef) {
  const v5 = useUiV5();
  const [localValue, setLocalValue] = useState(defaultValue);
  const [invalid, setInvalid] = useState(false);
  const parent = useRef(null);
  const review = globalThis.document?.documentElement.dataset.v5Review === "true";
  if (!v5 && !review) {
    return <select {...props} ref={forwardedRef} value={value} defaultValue={defaultValue} onChange={onChange}>{children}</select>;
  }
  const options = nativeOptions(children);
  const selected = String(value ?? localValue ?? options.find((option) => !option.disabled)?.value ?? "");
  const { className, style, size, multiple, ...attributes } = props;
  if (multiple) return <select {...props} ref={forwardedRef} value={value} defaultValue={defaultValue} onChange={onChange}>{children}</select>;
  return <span ref={parent} className={`v5-native-select inline-block relative min-w-0 p-0 border-0 bg-transparent shadow-none ${className || ""}`} style={style}>
    <Select {...attributes} name={undefined} size={size === "sm" ? "sm" : "md"} value={selected} options={options}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      onChange={(next) => {
        setLocalValue(next);
        setInvalid(false);
        onChange?.({ target: { value: next, name: props.name }, currentTarget: { value: next, name: props.name } });
      }} fullWidth />
    <select ref={forwardedRef} name={props.name} form={props.form} required={props.required} disabled={props.disabled} value={selected}
      tabIndex={-1} aria-hidden="true" className="v5-native-select-control absolute w-px h-px opacity-0 pointer-events-none" onChange={() => {}}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); parent.current?.querySelector('[role="combobox"]')?.focus(); }}>
      {children}
    </select>
    {invalid && <span role="alert" className="v5-native-select-error block text-xs text-dd-danger mt-1">Choose an option.</span>}
  </span>;
});
