"use client";

import Select from "@/shared/ui/components/Select.jsx";
import { V5NativeSelect } from "@/shared/ui/v5/NativeSelect.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";

/** Incumbent Select when the switch is off. On, the same value still flows through `onChange`. */
export default function CliOptionSelect({ value, onChange, options = [], ...props }) {
  const v5 = useUiV5();
  if (!v5) return <Select value={value} onChange={onChange} options={options} {...props} />;
  return (
    <V5NativeSelect value={value} onChange={(event) => onChange(event.target.value)} {...props}>
      {options.map((option) => (
        <option key={String(option.value)} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </V5NativeSelect>
  );
}
