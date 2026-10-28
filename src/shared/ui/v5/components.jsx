import { useEffect, useId, useRef, useState } from "react";

export function Icon({ name, size = 18 }) {
  return (
    <span
      aria-hidden="true"
      className="material-symbols-outlined v5-icon"
      style={{ fontSize: size }}
    >
      {name}
    </span>
  );
}
export function Button({
  children,
  icon,
  tone = "default",
  busy = false,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`v5-button v5-button-${tone} ${className}`}
    >
      {icon && <Icon name={busy ? "progress_activity" : icon} />}
      {children}
    </button>
  );
}
export function IconButton({ label, icon, className = "", ...props }) {
  return (
    <Button
      {...props}
      icon={icon}
      aria-label={label}
      title={label}
      className={`v5-icon-button ${className}`}
    />
  );
}
const toneForStatus = {
  Connected: "success",
  Healthy: "success",
  Active: "success",
  Success: "success",
  Enabled: "success",
  Ready: "success",
  Warning: "warning",
  Degraded: "warning",
  "Rate limited": "warning",
  Expiring: "warning",
  Error: "danger",
  Failed: "danger",
  Expired: "danger",
  Disabled: "neutral",
  Pending: "info",
  Running: "info",
};
export function Badge({ children, tone }) {
  return (
    <span
      className={`v5-badge v5-badge-${tone || toneForStatus[children] || "neutral"}`}
    >
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
export function Notice({ tone = "info", title, children, action }) {
  return (
    <div
      className={`v5-notice v5-notice-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon
        name={
          tone === "danger"
            ? "error"
            : tone === "success"
              ? "check_circle"
              : tone === "warning"
                ? "warning"
                : "info"
        }
      />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
export function Field({ label, hint, error, children, id: suppliedId }) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return (
    <div className="v5-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-describedby": hint || error ? `${id}-hint` : undefined,
        "aria-invalid": !!error,
      })}
      <p id={`${id}-hint`} className={error ? "v5-error-text" : "v5-muted"}>
        {error || hint}
      </p>
    </div>
  );
}
export function Switch({ label, description, checked, onChange, disabled }) {
  const id = useId();
  return (
    <div className="v5-switch-row">
      <label htmlFor={id}>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </div>
  );
}
/** Native top-layer dialog supplies inert background, focus containment and focus return. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  drawer = false,
  pending = false,
}) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`v5-dialog ${drawer ? "v5-drawer" : ""}`}
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header>
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p id={`${id}-description`}>{description}</p>}
        </div>
        <IconButton
          label="Close dialog"
          icon="close"
          onClick={onClose}
          disabled={pending}
        />
      </header>
      <div className="v5-dialog-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
  icon = "inbox",
}) {
  return (
    <div className="v5-empty">
      <div className="v5-empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Skeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page"
      className="v5-skeleton-layout"
    >
      <div className="v5-skeleton v5-skeleton-heading" />
      <div className="v5-skeleton v5-skeleton-line" />
      <div className="v5-skeleton v5-skeleton-chart" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="v5-skeleton v5-skeleton-row" />
      ))}
      <span className="v5-sr-only">Loading sample data</span>
    </div>
  );
}
export function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <Button icon={copied ? "check" : "content_copy"} onClick={copy}>
        {copied ? "Copied" : label}
      </Button>
      {failed && (
        <span role="alert" className="v5-error-text">
          Copy unavailable. Select the text to copy it.
        </span>
      )}
    </>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <section className={`v5-panel ${className}`}>
      <div className="v5-panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
