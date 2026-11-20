/** Keep the provider rate limit identifiable at every viewport width. */
export default function ProviderRpmControl({ value, placeholder, max, onChange, onSave }) {
  return <>
    <label htmlFor="provider-rpm-limit" className="text-xs text-dd-muted">RPM / account</label>
    <input
      id="provider-rpm-limit"
      type="number"
      min="0"
      max={max}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onSave(event.target.value)}
      title="Maximum requests per minute per account. Blank uses provider default; 0 is unlimited."
      className="min-h-11 w-16 rounded-dd border border-dd-border bg-dd-surface px-2 text-xs text-dd-text outline-none placeholder:text-dd-subtle focus:border-dd-accent focus-visible:shadow-dd-focus" />
  </>;
}
